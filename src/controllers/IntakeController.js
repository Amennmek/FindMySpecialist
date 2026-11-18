const { validateSelection } = require('../services/InsuranceCatalog');

class IntakeController {
  constructor(service) {
    this.service = service;
  }

  search = (req, res) => {
    res.json({ symptoms: this.service.search(req.query.q || '') });
  };

  submit = (req, res) => {
    const body = req.body || {};
    const zip = String(body.zip || '').trim();
    const age = body.age;
    const insurerId = String(body.insurerId || '').trim();
    const planId = String(body.planId || '').trim();
    const symptoms = Array.isArray(body.symptoms) ? body.symptoms : [];
    const symptomResult = this.service.validateSymptoms(symptoms);
    const selection = validateSelection(insurerId, planId);

    const city = String(body.city || '').trim();
    const state = String(body.state || '').trim().toUpperCase();
    if (!city || city.length > 100 || !/^[A-Z]{2}$/.test(state) || !/^\d{5}$/.test(zip)) {
      return res.status(400).json({
        valid: false,
        status: 'Error',
        message: 'Enter a city, two-letter state, and valid five-digit ZIP code.'
      });
    }

    if (age === undefined || age === null ||
        !Number.isInteger(Number(age)) || Number(age) < 1 || Number(age) > 120) {
      return res.status(400).json({
        valid: false,
        status: 'Error',
        message: 'Please enter a valid age between 1 and 120.'
      });
    }

    if (!selection.valid) {
      return res.status(400).json({
        valid: false,
        status: 'Error',
        message: selection.message
      });
    }

    if (!symptomResult.valid) {
      const status = symptomResult.status === 'Urgent' ? 200 : 400;
      return res.status(status).json(symptomResult);
    }

    const intake = {
      city, state, zip,
      age: Number(age),
      insurerId,
      planId,
      symptoms
    };

    if (req.session) {
      req.session.intake = {
        ...(req.session.intake || {}),
        ...intake,
        evaluationStatus: symptomResult.status
      };
    }

    return res.status(200).json({
      valid: true,
      status: 'Ready',
      message: 'Intake complete.',
      intake
    });
  };
}

module.exports = IntakeController;
