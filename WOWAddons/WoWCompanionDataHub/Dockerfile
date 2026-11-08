FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATAHUB_DATABASE=/data/statistics.sqlite
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 datahub \
    && useradd --uid 10001 --gid 10001 --no-create-home datahub \
    && mkdir /data \
    && chown 10001:10001 /data
COPY server.py store.py backup.py ./
COPY web ./web
USER 10001:10001
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=3).read()"
CMD ["gunicorn", "--bind=0.0.0.0:8080", "--workers=1", "--worker-class=gthread", "--threads=8", "--worker-connections=64", "--timeout=30", "--keep-alive=2", "--limit-request-line=4094", "--limit-request-fields=40", "--limit-request-field_size=4094", "server:create_app()"]
