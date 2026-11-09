import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

/**
 * Architecture
 *   Browser ──HTTPS──▶ CloudFront ──HTTP + secret header──▶ ALB ─┬─ /api/*  ▶ Fargate: FastAPI (+TeX Live) ─▶ RDS Postgres
 *                                                                └─ /*      ▶ Fargate: Next.js
 * With `-c certificateArn=... ` the ALB serves HTTPS directly on your own domain and CloudFront is skipped
 * (this also lifts CloudFront's 60s origin timeout, which matters for slow AI tailoring requests).
 */
export class HirePilotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const certificateArn = this.node.tryGetContext("certificateArn") as string | undefined;
    const arm = {
      cpuArchitecture: ecs.CpuArchitecture.ARM64,
      operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    };

    // ---------- network + data ----------
    const vpc = new ec2.Vpc(this, "Vpc", { maxAzs: 2, natGateways: 1 });
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });

    const db = new rds.DatabaseInstance(this, "Db", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      databaseName: "hirepilot",
      credentials: rds.Credentials.fromGeneratedSecret("hirepilot"),
      allocatedStorage: 20,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(7),
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    const appToken = new secrets.Secret(this, "AppToken", {
      description: "HirePilot: enter this in the app's Settings page",
      generateSecretString: { passwordLength: 32, excludePunctuation: true },
    });
    const secretKey = new secrets.Secret(this, "SecretKey", {
      description: "HirePilot: derives the key that encrypts the stored OpenAI key",
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });
    const originSecret = new secrets.Secret(this, "OriginVerify", {
      generateSecretString: { passwordLength: 32, excludePunctuation: true },
    });

    // ---------- backend (FastAPI + pdflatex) ----------
    const apiTask = new ecs.FargateTaskDefinition(this, "ApiTask", {
      cpu: 1024,
      memoryLimitMiB: 2048,
      runtimePlatform: arm,
    });
    apiTask.addContainer("api", {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, "../../backend"), {
        platform: ecrAssets.Platform.LINUX_ARM64,
      }),
      portMappings: [{ containerPort: 8000 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "api",
        logGroup: new logs.LogGroup(this, "ApiLogs", {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
      environment: {
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: db.dbInstanceEndpointPort,
        DB_NAME: "hirepilot",
      },
      secrets: {
        DB_USER: ecs.Secret.fromSecretsManager(db.secret!, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, "password"),
        APP_TOKEN: ecs.Secret.fromSecretsManager(appToken),
        SECRET_KEY: ecs.Secret.fromSecretsManager(secretKey),
      },
    });
    // desiredCount 1: the job-refresh progress indicator lives in process memory.
    const apiService = new ecs.FargateService(this, "Api", {
      cluster,
      taskDefinition: apiTask,
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: cdk.Duration.seconds(90),
      circuitBreaker: { rollback: true },
    });
    db.connections.allowDefaultPortFrom(apiService);

    // ---------- frontend (Next.js standalone) ----------
    const webTask = new ecs.FargateTaskDefinition(this, "WebTask", {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: arm,
    });
    webTask.addContainer("web", {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, "../../frontend"), {
        platform: ecrAssets.Platform.LINUX_ARM64,
      }),
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "web",
        logGroup: new logs.LogGroup(this, "WebLogs", {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
    });
    const webService = new ecs.FargateService(this, "Web", {
      cluster,
      taskDefinition: webTask,
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: cdk.Duration.seconds(30),
      circuitBreaker: { rollback: true },
    });

    // ---------- load balancer ----------
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      idleTimeout: cdk.Duration.seconds(120),
    });

    const routes = (listener: elbv2.ApplicationListener, extra: elbv2.ListenerCondition[], webIsDefault: boolean) => {
      listener.addTargets("ApiTargets", {
        priority: 10,
        conditions: [...extra, elbv2.ListenerCondition.pathPatterns(["/api/*"])],
        port: 8000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [apiService],
        healthCheck: { path: "/api/health", interval: cdk.Duration.seconds(30) },
        deregistrationDelay: cdk.Duration.seconds(15),
      });
      listener.addTargets("WebTargets", {
        ...(webIsDefault ? {} : { priority: 20, conditions: extra }),
        port: 3000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [webService],
        healthCheck: { path: "/", healthyHttpCodes: "200,307" },
        deregistrationDelay: cdk.Duration.seconds(15),
      });
    };

    if (certificateArn) {
      // Own domain: ALB terminates TLS. Point a CNAME/ALIAS at the ALB DNS name.
      const https = alb.addListener("Https", {
        port: 443,
        certificates: [acm.Certificate.fromCertificateArn(this, "Cert", certificateArn)],
      });
      routes(https, [], true);
      alb.addRedirect({
        sourceProtocol: elbv2.ApplicationProtocol.HTTP,
        sourcePort: 80,
        targetProtocol: elbv2.ApplicationProtocol.HTTPS,
        targetPort: 443,
      });
      new cdk.CfnOutput(this, "AlbDnsName", { value: alb.loadBalancerDnsName, description: "Point your domain here" });
    } else {
      // No domain needed: CloudFront gives a free https://*.cloudfront.net URL. The ALB only answers
      // requests carrying the secret header that CloudFront adds, so it can't be hit directly.
      const http = alb.addListener("Http", {
        port: 80,
        open: true,
        defaultAction: elbv2.ListenerAction.fixedResponse(403, { contentType: "text/plain", messageBody: "Forbidden" }),
      });
      routes(
        http,
        [elbv2.ListenerCondition.httpHeader("X-Origin-Verify", [originSecret.secretValue.unsafeUnwrap()])],
        false,
      );

      const origin = new origins.LoadBalancerV2Origin(alb, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        readTimeout: cdk.Duration.seconds(60), // CloudFront's default ceiling; AI tailoring should finish well inside it
        customHeaders: { "X-Origin-Verify": originSecret.secretValue.unsafeUnwrap() },
      });
      const dist = new cloudfront.Distribution(this, "Cdn", {
        defaultBehavior: {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
        additionalBehaviors: {
          "/_next/static/*": {
            origin,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            compress: true,
          },
        },
      });
      new cdk.CfnOutput(this, "SiteUrl", { value: `https://${dist.distributionDomainName}` });
    }

    new cdk.CfnOutput(this, "AppTokenSecretArn", {
      value: appToken.secretArn,
      description: "aws secretsmanager get-secret-value --secret-id <this> --query SecretString --output text",
    });
  }
}
