FROM python:3.12-alpine

WORKDIR /app
COPY docket /app/docket
COPY web /app/web

ENV DOCKET_DASHBOARDS_DIR=/data/dashboards \
    DOCKET_WEB_DIR=/app/web \
    DOCKET_HOST=0.0.0.0 \
    DOCKET_PORT=8080 \
    PYTHONUNBUFFERED=1

EXPOSE 8080

CMD ["python", "-m", "docket.server"]
