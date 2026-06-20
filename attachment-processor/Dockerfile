FROM python:3.11-slim

WORKDIR /app

# System dependencies for pdfplumber, Pillow, OpenCV, and Paddle runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libjpeg62-turbo \
    libpng16-16 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY app/ ./app/
COPY storage/ ./storage/

# Create storage subdirs
RUN mkdir -p /app/storage/uploads /app/storage/parsed

EXPOSE 8091
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8091"]
