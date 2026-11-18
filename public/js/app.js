
function appointmentSearchUrl(provider) {
  // NPPES does not provide booking URLs. This is a search link, not a verified booking page.
  const parts = [provider.clinic, provider.name, provider.location, provider.zip, 'appointments'];
  return 'https://www.google.com/search?' + new URLSearchParams({
    q: parts.filter(Boolean).join(' ')
  }).toString();
}

const $ = id => document.getElementById(id);
const api = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed.');
  return data;
};
const post = (url, body) => api(url, {
  method: 'POST',
  body: JSON.stringify(body)
});
const message = (text, type = '') => {
  const target = $('message');
  if (!target) return;
  target.textContent = text;
  target.className = type ? `notice ${type}` : 'notice';
};
const load = (key, fallback) => {
  try {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};
const store = (key, value) => sessionStorage.setItem(key, JSON.stringify(value));
const intakeState = () => load('intake', {});

const accessReady = (async () => {
  const current = await api('/api/auth/me');
  const hasAccess = current.accessType === 'Guest' || current.accessType === 'Login';
  const protectedPaths = new Set([
    '/intake.html',
    '/match.html',
    '/specialists.html',
    '/details.html'
  ]);

  for (const link of document.querySelectorAll('header nav a')) {
    if (!protectedPaths.has(new URL(link.href, location.href).pathname)) continue;
    link.hidden = !hasAccess;
    link.setAttribute('aria-hidden', String(!hasAccess));
    if (!hasAccess) link.removeAttribute('href');
  }

  if (current.intake && Object.keys(current.intake).length) {
    store('intake', current.intake);
  }

  if (!hasAccess && protectedPaths.has(location.pathname)) {
    location.replace('/index.html?authRequired=1');
  }

  if (new URLSearchParams(location.search).has('authRequired')) {
    message('Continue as a guest or log in to access Symptoms, Match, Find, and Details.');
  }

  return current;
})().catch(error => {
  message(error.message, 'error');
  return null;
});

if ($('guest')) {
  $('guest').onclick = async () => {
    $('guest').disabled = true;
    try {
      await post('/api/auth/guest', {});
      sessionStorage.removeItem('intake');
      sessionStorage.removeItem('specialties');
      location.href = '/intake.html';
    } catch (error) {
      message(error.message, 'error');
      $('guest').disabled = false;
    }
  };
}

if ($('loginForm')) {
  $('loginForm').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"], button:not([type])');
    if (button) button.disabled = true;

    try {
      await post('/api/auth/login', {
        email: form.elements.email.value,
        password: form.elements.password.value
      });
      location.href = '/intake.html';
    } catch (error) {
      message(error.message, 'error');
      if (button) button.disabled = false;
    }
  };
}

if ($('signupForm')) {
  $('signupForm').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"], button:not([type])');
    if (button) button.disabled = true;

    try {
      const credentials = {
        email: form.elements.email.value,
        password: form.elements.password.value
      };
      await post('/api/auth/register', credentials);
      await post('/api/auth/login', credentials);
      location.href = '/intake.html';
    } catch (error) {
      message(error.message, 'error');
      if (button) button.disabled = false;
    }
  };
}

if ($('intakeForm')) {
  (async () => {
    const current = await accessReady;
    const form = $('intakeForm');
    const providerSelect = $('insuranceProvider');
    const planSelect = $('insurancePlan');
    const searchInput = $('symptomSearch');
    const choices = $('symptomChoices');
    const selected = new Set(intakeState().symptoms ?? []);

    const addOption = (select, value, label) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    };

    const catalog = await api('/api/catalog');
    addOption(providerSelect, '', 'Select a provider (optional)');
    const catalogInsurers = Array.isArray(catalog.insuranceCatalog.insurers)
      ? catalog.insuranceCatalog.insurers
      : Object.entries(catalog.insuranceCatalog.insurers).map(([id, insurer]) => ({
        id,
        ...insurer
      }));
    for (const insurer of catalogInsurers) {
      addOption(providerSelect, insurer.id, insurer.name);
    }
    const previous = { ...(current?.preferences ?? {}), ...intakeState() };
    providerSelect.value = previous.insurerId ?? previous.insuranceProviderId ?? '';

    const updatePlans = (planId = '') => {
      planSelect.replaceChildren();
      const insurer = catalogInsurers.find(item => item.id === providerSelect.value);
      const plans = insurer?.plans ?? [];
      const planList = Array.isArray(plans)
        ? plans
        : Object.entries(plans).map(([id, plan]) => ({ id, ...plan }));
      addOption(planSelect, '', 'Any plan');
      for (const plan of planList) {
        addOption(planSelect, plan.id, plan.name);
      }
      planSelect.disabled = !insurer;
      planSelect.value = planId;
    };
    providerSelect.onchange = () => {
      planSelect.value = '';
      updatePlans();
    };
    updatePlans(previous.planId ?? previous.insurancePlanId ?? '');

    for (const field of ['city', 'state', 'zip']) {
      $(field).value = previous[field] ?? '';
    }
    $('age').value = previous.age ?? '';

    const renderSymptoms = async () => {
      const { symptoms } = await api(
        `/api/symptoms?q=${encodeURIComponent(searchInput.value.trim())}`
      );
      choices.replaceChildren();
      for (const symptom of symptoms) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = symptom;
        checkbox.checked = selected.has(symptom);
        checkbox.disabled = !checkbox.checked && selected.size >= 3;
        checkbox.onchange = () => {
          if (checkbox.checked) selected.add(symptom);
          else selected.delete(symptom);
          $('selectedCount').textContent = `${selected.size} of 3 selected`;
          renderSymptoms().catch(error => message(error.message, 'error'));
        };
        label.append(checkbox, document.createTextNode(symptom));
        choices.append(label);
      }
      $('selectedCount').textContent = `${selected.size} of 3 selected`;
    };

    searchInput.oninput = () => {
      renderSymptoms().catch(error => message(error.message, 'error'));
    };
    await renderSymptoms();

    form.onsubmit = async event => {
      event.preventDefault();
      const intake = {
        city: $('city').value.trim(),
        state: $('state').value.trim().toUpperCase(),
        zip: $('zip').value.trim(),
        age: Number($('age').value),
        insurerId: providerSelect.value,
        planId: planSelect.value,
        symptoms: [...selected]
      };

      try {
        const result = await post('/api/intake/symptoms', intake);
        if (!result.valid) {
          message(result.message, result.status === 'Urgent' ? 'urgent' : 'error');
          return;
        }

        store('intake', result.intake);
        location.href = '/match.html';
      } catch (error) {
        message(error.message, 'error');
      }
    };
  })().catch(error => message(error.message, 'error'));
}

if ($('matchPage')) {
  (async () => {
    await accessReady;
    const state = intakeState();
    const result = await post('/api/match', {
      symptoms: state.symptoms ?? []
    });
    $('matchSummary').textContent = result.message || result.matchStatus;
    const matches = $('matches');
    matches.replaceChildren();

    for (const specialty of result.specialties ?? []) {
      const item = document.createElement('p');
      item.textContent = specialty;
      matches.append(item);
    }
    store('specialties', result.specialties ?? []);

    $('backToIntake').onclick = () => {
      location.href = '/intake.html';
    };
    $('findSpecialistsBtn').onclick = () => {
      location.href = '/specialists.html';
    };
  })().catch(error => message(error.message, 'error'));
}

if ($('specialistsPage')) {
  (async () => {
    const current = await accessReady;
    const form = $('searchForm');
    const zipInput = $('zip');
    const distanceInput = $('maxDistance');
    const insurerInput = $('insurerId');
    const planInput = $('planId');
    const exactPlanInput = $('exactPlanOnly');
    const catalog = await api('/api/catalog');
    const insurers = catalog.insuranceCatalog.insurers;

    function addParagraph(parent, text) {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      parent.append(paragraph);
    }

    function addInsuranceSection(parent, provider) {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = 'Insurance';
      section.append(heading);

      const listings = provider.insuranceListings ?? [];
      addParagraph(
        section,
        provider.insuranceStatus ??
          (listings.length
            ? 'Published listings shown; choose an insurer and plan to compare.'
            : 'Insurance information unavailable')
      );

      for (const listing of listings) {
        const publishedDetails = [
          listing.insurer,
          listing.exactPlanName,
          listing.planType,
          listing.description
        ].filter(Boolean);
        const row = document.createElement('p');
        row.append(document.createTextNode(publishedDetails.join(' · ')));
        if (listing.networkStatus === 'out') {
          row.append(document.createTextNode(' — source lists as out of network'));
        } else if (listing.networkStatus === 'in') {
          row.append(document.createTextNode(' — source lists as accepted'));
        }

        row.append(document.createTextNode(' · '));
        const source = document.createElement('a');
        source.href = listing.sourceUrl;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent =
          listing.sourceType === 'provider' ? 'Provider profile' : 'Clinic page';
        row.append(source);
        if (listing.dateChecked) {
          row.append(document.createTextNode(` (checked ${listing.dateChecked})`));
        }
        section.append(row);
      }

      parent.append(section);
    }

    function searchParams(filters, specialties) {
      return new URLSearchParams({
        zip: filters.zip,
        maxDistance: filters.maxDistance,
        specialties: specialties.join(','),
        insurerId: filters.insurerId,
        planId: filters.planId,
        exactPlanOnly: String(filters.exactPlanOnly)
      });
    }

    function renderResults(results, disclaimer, filters, specialties) {
      const root = $('results');
      root.replaceChildren();
      if (disclaimer) addParagraph(root, disclaimer);

      if (!results.length) {
        addParagraph(root, filters.exactPlanOnly
          ? 'No exact in-network plan matches were found. Other providers are hidden by the selected filter.'
          : 'No practices matched this specialty and distance.');
        return;
      }

      for (const provider of results) {
        const card = document.createElement('div');
        card.className = 'provider';

        const title = document.createElement('strong');
        title.textContent = provider.name;
        card.append(title);

        const address = [provider.location, provider.zip].filter(Boolean).join(' ');
        addParagraph(card, [provider.specialty, provider.clinic, address]
          .filter(Boolean).join(' • '));
        addParagraph(card, provider.phone
          ? `Phone: ${provider.phone}`
          : 'Phone unavailable');
        addParagraph(card, Number.isFinite(provider.distanceMiles)
          ? `Approx. ${provider.distanceMiles.toFixed(1)} miles from ZIP center`
          : 'Distance unavailable');
        addInsuranceSection(card, provider);

        const detailsParams = searchParams(filters, specialties);
        detailsParams.set('id', provider.id);
        const detailsLink = document.createElement('a');
        detailsLink.href = `/details.html?${detailsParams}`;
        detailsLink.textContent = 'View Details';
        card.append(detailsLink);

        {
          const bookingLink = document.createElement('a');
          bookingLink.href = provider.bookingUrl || appointmentSearchUrl(provider);
          bookingLink.target = '_blank';
          bookingLink.rel = 'noopener noreferrer';
          bookingLink.textContent = provider.bookingUrl ? 'Request an appointment with the clinic' : 'Find clinic appointment options (search)';
          const actions = document.createElement('p');
          actions.append(bookingLink);
          card.append(actions);
        }

        root.append(card);
      }
    }

    function updatePlans(selectedPlan = '') {
      planInput.replaceChildren();
      const insurer = insurers[insurerInput.value];
      const plans = insurer?.plans ?? {};

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = insurer
        ? Object.keys(plans).length
          ? 'Any plan / insurer only'
          : 'No plan names published'
        : 'Select an insurer first';
      planInput.append(placeholder);

      for (const [id, plan] of Object.entries(plans)) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = plan.name;
        option.dataset.matchType = plan.matchType;
        planInput.append(option);
      }

      planInput.disabled = !insurer || !Object.keys(plans).length;
      planInput.value = selectedPlan;
      exactPlanInput.checked = false;
      exactPlanInput.disabled =
        !planInput.selectedOptions[0]?.dataset.matchType ||
        planInput.selectedOptions[0].dataset.matchType !== 'exact';
    }

    const urlFilters = new URLSearchParams(location.search);
    const savedFilters = load('filters', {});
    const intake = intakeState();
    const filters = {
      zip: urlFilters.get('zip') ?? savedFilters.zip ??
        intake.zip ?? current?.preferences?.zip ?? '',
      maxDistance:
        urlFilters.get('maxDistance') ?? savedFilters.maxDistance ?? '10',
      insurerId:
        urlFilters.get('insurerId') ?? savedFilters.insurerId ??
        intake.insurerId ?? current?.preferences?.insurerId ?? '',
      planId:
        urlFilters.get('planId') ?? savedFilters.planId ??
        intake.planId ?? current?.preferences?.planId ?? '',
      exactPlanOnly:
        (urlFilters.get('exactPlanOnly') ?? String(savedFilters.exactPlanOnly)) === 'true'
    };

    zipInput.value = filters.zip;
    distanceInput.value = filters.maxDistance;
    for (const [id, insurer] of Object.entries(insurers)) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = insurer.name;
      insurerInput.append(option);
    }
    insurerInput.value = insurers[filters.insurerId] ? filters.insurerId : '';
    updatePlans(filters.planId);
    exactPlanInput.checked =
      filters.exactPlanOnly && !exactPlanInput.disabled;

    insurerInput.onchange = () => updatePlans();
    planInput.onchange = () => {
      exactPlanInput.checked = false;
      exactPlanInput.disabled =
        planInput.selectedOptions[0]?.dataset.matchType !== 'exact';
    };

    async function search() {
      if (!zipInput.value || !form.reportValidity()) return;

      const selected = load('specialties', []);
      const specialties = Array.isArray(selected) && selected.length
        ? selected
        : intakeState().specialties ?? [];
      const currentFilters = {
        zip: zipInput.value.trim(),
        maxDistance: distanceInput.value,
        insurerId: insurerInput.value,
        planId: planInput.value,
        exactPlanOnly: exactPlanInput.checked
      };
      const query = searchParams(currentFilters, specialties);

      $('results').replaceChildren();
      message('Searching for providers…');

      try {
        const response = await api(`/api/providers?${query}`);
        store('filters', currentFilters);
        renderResults(
          response.results ?? [],
          response.disclaimer ?? '',
          currentFilters,
          specialties
        );
        message('');
      } catch (error) {
        message(error.message, 'error');
      }
    }

    form.onsubmit = event => {
      event.preventDefault();
      search();
    };

    $('clearFilters').onclick = async () => {
      try {
        await post('/api/providers/clear', {});
        sessionStorage.removeItem('filters');
        zipInput.value = intakeState().zip || '';
        distanceInput.value = '10';
        insurerInput.value = '';
        updatePlans();
        $('results').replaceChildren();
        if (zipInput.value) await search();
        else message('');
      } catch (error) {
        message(error.message, 'error');
      }
    };

    $('savePrefs').onclick = async () => {
      if (!form.reportValidity()) return;

      try {
        await post('/api/auth/preferences', {
          zip: zipInput.value.trim(),
          insurerId: insurerInput.value,
          planId: planInput.value
        });
        message('Preferences saved.');
      } catch (error) {
        message(error.message, 'error');
      }
    };

    if (filters.zip) search();
  })().catch(error => message(error.message, 'error'));
}

if ($('providerDetails')) {
  (async () => {
    await accessReady;
    try {
      const params = new URLSearchParams(location.search);
      const id = params.get('id');

      if (!id) {
        message('Choose a provider from Find Specialists.');
        return;
      }

      const detailQuery = new URLSearchParams({
        insurerId: params.get('insurerId') ?? '',
        planId: params.get('planId') ?? ''
      });
      const { provider, message: notice } = await api(
        `/api/providers/${encodeURIComponent(id)}?${detailQuery}`
      );
      const root = $('providerDetails');
      const fields = [
        ['Name', provider.name],
        ['Specialty', provider.specialty],
        ['Clinic', provider.clinic],
        ['Location', [provider.location, provider.zip].filter(Boolean).join(' ')],
        ['Phone', provider.phone]
      ];

      for (const [label, value] of fields) {
        const line = document.createElement('p');
        line.textContent = `${label}: ${value || 'Not provided'}`;
        root.append(line);
      }

      const insuranceRoot = $('insuranceDetails');
      const status = document.createElement('p');
      status.textContent = provider.insuranceStatus ??
        ((provider.insuranceListings ?? []).length
          ? 'Published listings shown; choose an insurer and plan to compare.'
          : 'Insurance information unavailable');
      insuranceRoot.append(status);

      for (const listing of provider.insuranceListings ?? []) {
        const row = document.createElement('p');
        row.append(document.createTextNode([
          listing.insurer,
          listing.exactPlanName,
          listing.planType,
          listing.description
        ].filter(Boolean).join(' · ')));
        if (listing.networkStatus === 'out') {
          row.append(document.createTextNode(' — source lists as out of network'));
        } else if (listing.networkStatus === 'in') {
          row.append(document.createTextNode(' — source lists as accepted'));
        }
        row.append(document.createTextNode(' · '));

        const source = document.createElement('a');
        source.href = listing.sourceUrl;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent =
          listing.sourceType === 'provider' ? 'Provider profile' : 'Clinic page';
        row.append(source);
        if (listing.dateChecked) {
          row.append(document.createTextNode(` (checked ${listing.dateChecked})`));
        }
        insuranceRoot.append(row);
      }

      const backParams = new URLSearchParams(params);
      backParams.delete('id');
      $('backToResults').href = `/specialists.html?${backParams}`;

      {
        const link = document.createElement('a');
        link.href = provider.bookingUrl || appointmentSearchUrl(provider);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = provider.bookingUrl ? 'Request an appointment with the clinic' : 'Find clinic appointment options (search)';
        root.append(link);
      }
      if (notice && !provider.bookingUrl) {
        const line = document.createElement('p');
        line.textContent = notice;
        root.append(line);
      }
    } catch (error) {
      message(error.message, 'error');
    }
  })().catch(error => message(error.message, 'error'));
}
