FROM python:3.12-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends g++ default-jdk-headless nodejs \
    && rm -rf /var/lib/apt/lists/*
COPY execute.py /opt/execute.py
WORKDIR /work
USER 65534:65534
ENTRYPOINT []
CMD ["python3", "/opt/execute.py"]

FROM python:3.12-slim AS controller
RUN pip install --no-cache-dir fastapi==0.115.12 uvicorn==0.34.2 httpx==0.28.1
COPY controller.py /srv/controller.py
WORKDIR /srv
CMD ["uvicorn", "controller:app", "--host", "0.0.0.0", "--port", "8080"]
