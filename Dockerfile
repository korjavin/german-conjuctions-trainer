# Build stage
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY main.go ./

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# Copy build script and configs
COPY build.sh tailwind.config.js ./
COPY src/input.css ./src/input.css

# Run the build script to generate CSS
RUN apk --no-cache add curl && chmod +x ./build.sh && ./build.sh

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
COPY index.html app.js privacy.html favicon.svg favicon-32x32.svg ./static/
COPY --from=builder /app/public ./static/public

# Make the binary executable and change ownership
RUN chmod +x ./main && chown -R appuser:appuser /app

USER appuser

# Expose port
EXPOSE 8080

# Set environment variables
ENV PORT=8080

# Run the application
CMD ["./main"]