package storage

import "fmt"

// MinReviewHours is the shortest wait before a practiced exercise is due
// again (5 minutes), so one just answered wrong (counter 0) is not due at once.
const MinReviewHours = 5.0 / 60

// NextReviewHours is the SRS wait after the last view: counter² hours, but at
// least MinReviewHours.
func NextReviewHours(counter int) float64 {
	return max(float64(counter*counter), MinReviewHours)
}

// dueSQL is the NextReviewHours rule as an SQL condition on the
// user_exercise_views row named t (a table name or alias).
func dueSQL(t string) string {
	return fmt.Sprintf("(julianday('now') - julianday(%[1]s.last_viewed)) * 24 >= MAX(%[1]s.repetition_counter * %[1]s.repetition_counter, %[2]v)",
		t, MinReviewHours)
}
