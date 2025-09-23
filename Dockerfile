# CSS build stage
FROM node:20-alpine AS css-builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tailwind.config.js .
COPY index.html .
COPY privacy.html .
COPY src/input.css ./src/input.css
RUN npx tailwindcss -i ./src/input.css -o ./public/style.css

# Build stage
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Copy all source code
COPY . .

# Download dependencies
RUN go mod download
COPY --from=css-builder /app/public/style.css ./public/style.css

# Build the application
# We still build from the root directory as main.go is there.
RUN CGO_ENABLED=0 GOOS=linux go build -o main .


# Final stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates

# Create a non-root user
RUN adduser -D -s /bin/sh appuser

# Create app directory
WORKDIR /app

# Copy the binary from builder stage
COPY --from=builder /app/main .

# Create static directory and copy frontend files
# These files are also present in the build context.
COPY index.html app.js privacy.html favicon.svg favicon-32x32.svg ./static/
COPY --from=builder /app/public/ ./static/

# Make the binary executable and change ownership
RUN chmod +x ./main && chown -R appuser:appuser /app

USER appuser

# Expose port
EXPOSE 8080

# Set environment variables
ENV PORT=8080

# Run the application
CMD ["./main"]