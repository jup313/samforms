FROM node:18-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

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
