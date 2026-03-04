package app

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

func writeJSONError(w http.ResponseWriter, status int, code, message, details string, retryable bool) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	errPayload := map[string]interface{}{
		"message":   message,
		"code":      code,
		"retryable": retryable,
	}
	if strings.TrimSpace(details) != "" {
		errPayload["details"] = details
	}

	if err := json.NewEncoder(w).Encode(map[string]interface{}{"error": errPayload}); err != nil {
		log.Printf("ERROR: failed to encode error response (status=%d code=%s): %v", status, code, err)
	}
}
