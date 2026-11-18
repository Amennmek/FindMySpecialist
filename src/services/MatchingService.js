const rules = require('../data/specialtyRules.json');

class MatchingService {
  constructor(symptomService) {
    this.symptomService = symptomService;
  }

  match(symptoms) {
    const selected = Array.isArray(symptoms) ? symptoms : [];
    const evaluation = this.symptomService.validateSymptoms(selected);
    if (!evaluation.valid) {
      return {
        ...evaluation,
        matchStatus: evaluation.status === 'Urgent' ? 'Warning' : 'Error',
        specialties: []
      };
    }

    const specialties = [...new Set(
      selected.flatMap(symptom => rules[symptom] ?? [])
    )];
    if (!specialties.length) specialties.push('Primary Care');
    specialties.sort((a, b) => a.localeCompare(b));

    return {
      valid: true,
      status: 'Ready',
      matchStatus: 'Matched',
      specialties,
      message: 'Recommendations are informational and are not a diagnosis.'
    };
  }
}

module.exports = MatchingService;
