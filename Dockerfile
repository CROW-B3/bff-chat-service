FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install uv && uv sync --no-editable
COPY . .
EXPOSE 8080
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
