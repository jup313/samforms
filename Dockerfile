FROM node:18-slim

WORKDIR /app

# Install pdftk (Java-based) and build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    pdftk-java \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p database pdf-templates/active pdf-templates/archive generated

# Expose the internal port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
