#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { HirePilotStack } from "../lib/hirepilot-stack";

const app = new cdk.App();
new HirePilotStack(app, "HirePilot", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
