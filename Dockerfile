FROM python:3.11-slim

# Instalar Stockfish y dependencias del sistema
RUN apt-get update && apt-get install -y \
    stockfish \
    && rm -rf /var/lib/apt/lists/*

# Directorio de trabajo
WORKDIR /app

# Instalar dependencias Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código
COPY . .

# Puerto que usa Cloud Run
ENV PORT=8080
EXPOSE 8080

# Arrancar la app
CMD uvicorn main:app --host 0.0.0.0 --port $PORT