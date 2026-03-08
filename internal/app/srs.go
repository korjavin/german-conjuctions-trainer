package app

import (
	"log"
	mrand "math/rand"
	"time"

	"german-conjunctions-trainer/pkg/storage"
)

func getEligibleExercisesForSRS(allExercises []*storage.Exercise, userViews map[string]*storage.UserExerciseView) []*storage.Exercise {
	type ScoredExercise struct {
		Exercise      *storage.Exercise
		OverdueAmount float64
		IsFavorite    bool
	}

	var candidates []ScoredExercise
	now := time.Now()

	for _, ex := range allExercises {
		view, seen := userViews[ex.ID]
		if seen && view.IsHidden {
			continue
		}
		if !seen {
			candidates = append(candidates, ScoredExercise{
				Exercise:      ex,
				OverdueAmount: 1000.0,
				IsFavorite:    false,
			})
			continue
		}

		daysSinceView := now.Sub(view.LastViewed).Hours() / 24
		nextReviewInDays := float64(view.RepetitionCounter * view.RepetitionCounter)
		overdueAmount := daysSinceView - nextReviewInDays

		log.Printf("[SRS_ELIGIBILITY] Exercise %s: counter=%d, days_since_view=%.2f, next_review_in=%.0f days, overdue=%.2f, favorite=%v",
			ex.ID, view.RepetitionCounter, daysSinceView, nextReviewInDays, overdueAmount, view.IsFavorite)

		if overdueAmount >= 0 {
			candidates = append(candidates, ScoredExercise{
				Exercise:      ex,
				OverdueAmount: overdueAmount,
				IsFavorite:    view.IsFavorite,
			})
		}
	}

	mrand.Shuffle(len(candidates), func(i, j int) {
		candidates[i], candidates[j] = candidates[j], candidates[i]
	})

	for i := 0; i < len(candidates)-1; i++ {
		for j := i + 1; j < len(candidates); j++ {
			overdueI := candidates[i].OverdueAmount
			overdueJ := candidates[j].OverdueAmount

			swap := false
			if overdueI < overdueJ {
				swap = true
			} else if overdueI == overdueJ {
				if !candidates[i].IsFavorite && candidates[j].IsFavorite {
					swap = true
				}
			}

			if swap {
				candidates[i], candidates[j] = candidates[j], candidates[i]
			}
		}
	}

	var eligible []*storage.Exercise
	for _, c := range candidates {
		eligible = append(eligible, c.Exercise)
	}

	log.Printf("[SRS_ELIGIBILITY] Total exercises checked: %d, eligible: %d", len(allExercises), len(eligible))
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
