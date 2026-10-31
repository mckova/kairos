# ---- build the React SPA ----------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- API + static files in one image -----------------------------------------
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 KAIROS_STATIC=/app/static
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=web /web/dist ./static
EXPOSE 8000
CMD ["sh", "-c", "python -m app.seed_if_empty && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
