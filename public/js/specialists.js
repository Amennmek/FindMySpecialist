

function verifiedUrl(url, verified) {
  if (verified !== true || typeof url !== 'string') return null;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function addProviderLink(parent, provider) {
  const booking = verifiedUrl(provider.bookingUrl, provider.bookingVerified);
  const profile = verifiedUrl(provider.providerUrl, provider.providerVerified);
  const action = document.createElement('p');

  if (booking || profile) {
    const link = document.createElement('a');
    link.href = booking || profile;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = booking ? 'Book Appointment' : 'View Provider Profile';
    action.append(link);
  } else {
    action.textContent = 'No booking link — unverified';
  }

  parent.append(action);
}

const $ = id => document.getElementById(id);

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || data.message || 'Request failed.');
  }

  return data;
}

function showMessage(text, type = '') {
  const target = $('message');
  target.textContent = text;
  target.className = type ? `notice ${type}` : 'notice';
}

function catalogInsurers(catalog) {
  const insurers = catalog.insurers ?? [];

  return Array.isArray(insurers)
    ? insurers
    : Object.entries(insurers).map(
        ([id, insurer]) => ({ id, ...insurer })
      );
}

function catalogPlans(insurer) {
  const plans = insurer?.plans ?? [];

  return Array.isArray(plans)
    ? plans
    : Object.entries(plans).map(
        ([id, plan]) => ({ id, ...plan })
      );
}

function appendText(parent, tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}

function appendInsurance(parent, provider) {
  const section = document.createElement('section');

  appendText(section, 'h3', 'Insurance');

  appendText(
    section,
    'p',
    provider.insuranceStatus ||
      'Insurance information unavailable'
  );

  for (const listing of provider.insuranceListings ?? []) {
    const description = [
      listing.insurer,
      listing.exactPlanName,
      listing.planType,
      listing.description
    ].filter(Boolean).join(' · ');

    const row = document.createElement('p');

    row.append(
      document.createTextNode(
        description || 'Published insurance information'
      )
    );

    if (listing.networkStatus === 'out') {
      row.append(
        document.createTextNode(' — listed as out of network')
      );
    } else if (listing.networkStatus === 'in') {
      row.append(
        document.createTextNode(' — listed as in network')
      );
    }

    row.append(document.createTextNode(' · '));

    const source = document.createElement('a');
    source.href = listing.sourceUrl;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.textContent =
      listing.sourceType === 'provider'
        ? 'Provider profile'
        : 'Clinic page';

    row.append(source);

    if (listing.dateChecked) {
      row.append(
        document.createTextNode(
          ` (checked ${listing.dateChecked})`
        )
      );
    }

    section.append(row);
  }

  parent.append(section);
}

async function initialize() {
  const auth = await requestJson('/api/auth/me');

  if (!['Guest', 'Login'].includes(auth.accessType)) {
    location.replace('/index.html?authRequired=1');
    return;
  }

  const catalogResponse = await requestJson('/api/catalog');
  const insurers = catalogInsurers(
    catalogResponse.insuranceCatalog
  );

  const form = $('searchForm');
  const insurerInput = $('insurerId');
  const planInput = $('planId');
  const selectedParams = new URLSearchParams(location.search);

  for (const insurer of insurers) {
    const option = document.createElement('option');
    option.value = insurer.id;
    option.textContent = insurer.name;
    insurerInput.append(option);
  }

  function updatePlans() {
    const priorValue = planInput.value;
    planInput.replaceChildren();

    const anyPlan = document.createElement('option');
    anyPlan.value = '';
    anyPlan.textContent = 'Any plan';
    planInput.append(anyPlan);

    const insurer = insurers.find(
      item => item.id === insurerInput.value
    );

    for (const plan of catalogPlans(insurer)) {
      const option = document.createElement('option');
      option.value = plan.id;
      option.textContent = plan.name;
      planInput.append(option);
    }

    planInput.disabled = !insurer;

    if (
      insurer &&
      [...planInput.options].some(
        option => option.value === priorValue
      )
    ) {
      planInput.value = priorValue;
    }
  }

  insurerInput.value = insurers.some(
    insurer => insurer.id === selectedParams.get('insurerId')
  )
    ? selectedParams.get('insurerId')
    : '';

  updatePlans();

  if (selectedParams.get('planId')) {
    planInput.value = selectedParams.get('planId');
  }

  insurerInput.addEventListener('change', () => {
    planInput.value = '';
    updatePlans();
  });

  // Restore the location entered during intake.
  let savedIntake = {};

  try {
    savedIntake = JSON.parse(
      sessionStorage.getItem('intake') || '{}'
    );
  } catch {
    savedIntake = {};
  }

  const initial = {
    ...(auth.intake || {}),
    ...savedIntake
  };

  for (const field of ['city', 'state', 'zip']) {
    $(field).value = initial[field] || '';
  }

  if (
    initial.insurerId &&
    !selectedParams.has('insurerId')
  ) {
    insurerInput.value = initial.insurerId;
    updatePlans();
    planInput.value = initial.planId || '';
  }

  function renderResults(
    results,
    notice,
    filters,
    specialties
  ) {
    const root = $('results');
    root.replaceChildren();

    if (!results.length) {
      appendText(
        root,
        'p',
        notice ||
          'No providers matched this specialty and distance.'
      );
      return;
    }

    for (const provider of results) {
      const card = document.createElement('article');
      card.className = 'provider';

      appendText(card, 'strong', provider.name);

      appendText(
        card,
        'p',
        [
          provider.specialty,
          provider.clinic,
          [provider.location, provider.zip]
            .filter(Boolean)
            .join(' ')
        ].filter(Boolean).join(' • ')
      );

      appendText(
        card,
        'p',
        provider.phone
          ? `Phone: ${provider.phone}`
          : 'Phone unavailable'
      );

      appendText(
        card,
        'p',
        `Approx. ${provider.distanceMiles.toFixed(1)} miles from your ZIP area.`
      );

      appendInsurance(card, provider);

      const detailParams = new URLSearchParams({
        id: provider.id,
        insurerId: filters.insurerId,
        planId: filters.planId
      });

      if (specialties.length) {
        detailParams.set(
          'specialties',
          specialties.join(',')
        );
      }

      const detailsLink = document.createElement('a');
      detailsLink.href = `/details.html?${detailParams}`;
      detailsLink.textContent = 'View Details';
      card.append(detailsLink);

      // Verified booking page, official profile, or no link.
      addProviderLink(card, provider);

      root.append(card);
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    const specialties = JSON.parse(
      sessionStorage.getItem('specialties') || '[]'
    );

    if (
      !Array.isArray(specialties) ||
      specialties.length === 0
    ) {
      showMessage(
        'Complete symptom matching before searching for specialists.',
        'error'
      );
      return;
    }

    const button = form.querySelector(
      'button[type="submit"]'
    );

    button.disabled = true;
    showMessage('Searching providers…');
    $('results').replaceChildren();

    try {
      const filters = {
        insurerId: insurerInput.value,
        planId: planInput.value
      };

      const result = await requestJson(
        '/api/providers/search',
        {
          method: 'POST',
          body: JSON.stringify({
            city: $('city').value.trim(),
            state: $('state').value.trim().toUpperCase(),
            zip: $('zip').value.trim(),
            maxDistance: $('maxDistance').value,
            specialties,
            ...filters
          })
        }
      );

      showMessage('');

      renderResults(
        result.results,
        result.noResultsMessage,
        filters,
        specialties
      );
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  $('clearFilters').addEventListener('click', () => {
    insurerInput.value = '';
    updatePlans();
    $('results').replaceChildren();
    showMessage('');
  });

  $('savePrefs').addEventListener('click', async () => {
    try {
      await requestJson('/api/auth/preferences', {
        method: 'POST',
        body: JSON.stringify({
          insurerId: insurerInput.value,
          planId: planInput.value
        })
      });

      showMessage(
        'Insurance preferences saved. Your state and ZIP are not saved.'
      );
    } catch (error) {
      showMessage(error.message, 'error');
    }
  });
}

initialize().catch(
  error => showMessage(error.message, 'error')
);
