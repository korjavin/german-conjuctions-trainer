# Build stage
FROM golang:1.23-alpine AS builder

# Install build dependencies for CGO (sqlite requires gcc)
RUN apk add --no-cache gcc musl-dev sqlite-dev

WORKDIR /app

# Copy all source code
COPY . .

# Download dependencies
RUN go mod download

# Build the application with CGO enabled for SQLite support
RUN CGO_ENABLED=1 GOOS=linux go build -o main ./cmd/server


# Final stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates sqlite-libs

# Create a non-root user
RUN adduser -D -s /bin/sh appuser

# Create app directory
WORKDIR /app

# Copy the binary from builder stage
COPY --from=builder /app/main .

# Create static directory and copy frontend files
# These files are also present in the build context.
COPY index.html app.js privacy.html style.css favicon.svg favicon-32x32.svg sw.js manifest.json ./static/
COPY js/ ./static/js/

# Make the binary executable and change ownership
RUN chmod +x ./main && chown -R appuser:appuser /app

USER appuser

# Expose port
EXPOSE 8080

# Set environment variables
ENV PORT=8080

# Run the application
CMD ["./main"]