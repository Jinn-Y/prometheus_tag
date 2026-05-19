FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HOST=0.0.0.0
ENV PORT=8000

WORKDIR /app

COPY app.py /app/app.py
COPY static /app/static

RUN mkdir -p /data /backups

EXPOSE 8000

CMD ["python", "app.py"]
