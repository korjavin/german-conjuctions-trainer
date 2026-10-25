package app

import (
	"log"
	mrand "math/rand"
	"sort"
	"time"

	"german-conjunctions-trainer/pkg/storage"
)

// getEligibleExercisesForSRS returns the exercises to serve, in order: due
// reviews first (most overdue first, favorites break ties), then never-seen
// exercises in random order. Reviews come first so practice works the due
// backlog down instead of always reaching for fresh exercises.
func getEligibleExercisesForSRS(allExercises []*storage.Exercise, userViews map[string]*storage.UserExerciseView) []*storage.Exercise {
	type ScoredExercise struct {
		Exercise      *storage.Exercise
		OverdueAmount float64
		IsFavorite    bool
	}

	var due []ScoredExercise
	var unseen []*storage.Exercise
	now := time.Now()

	for _, ex := range allExercises {
		view, seen := userViews[ex.ID]
		if seen && view.IsHidden {
			continue
		}
		if !seen {
			unseen = append(unseen, ex)
			continue
		}

		hoursSinceView := now.Sub(view.LastViewed).Hours()
		nextReviewInHours := storage.NextReviewHours(view.RepetitionCounter)
		overdueAmount := hoursSinceView - nextReviewInHours

		log.Printf("[SRS_ELIGIBILITY] Exercise %s: counter=%d, hours_since_view=%.2f, next_review_in=%.2f hours, overdue=%.2f, favorite=%v",
			ex.ID, view.RepetitionCounter, hoursSinceView, nextReviewInHours, overdueAmount, view.IsFavorite)

		if overdueAmount >= 0 {
			due = append(due, ScoredExercise{
				Exercise:      ex,
				OverdueAmount: overdueAmount,
				IsFavorite:    view.IsFavorite,
			})
		}
	}

	// Shuffle first so equal ranks come out in random order.
	mrand.Shuffle(len(due), func(i, j int) { due[i], due[j] = due[j], due[i] })
	mrand.Shuffle(len(unseen), func(i, j int) { unseen[i], unseen[j] = unseen[j], unseen[i] })
	sort.SliceStable(due, func(i, j int) bool {
		if due[i].OverdueAmount != due[j].OverdueAmount {
			return due[i].OverdueAmount > due[j].OverdueAmount
		}
		return due[i].IsFavorite && !due[j].IsFavorite
	})

	eligible := make([]*storage.Exercise, 0, len(due)+len(unseen))
	for _, c := range due {
		eligible = append(eligible, c.Exercise)
	}
	eligible = append(eligible, unseen...)

	log.Printf("[SRS_ELIGIBILITY] Total exercises checked: %d, eligible: %d (due %d, new %d)", len(allExercises), len(eligible), len(due), len(unseen))
	return eligible
}

func getRandomExercises(exercises []*storage.Exercise, count int) []*storage.Exercise {
	if len(exercises) <= count {
		return exercises
	}
	mrand.Shuffle(len(exercises), func(i, j int) {
		exercises[i], exercises[j] = exercises[j], exercises[i]
	})
	return exercises[:count]
}
