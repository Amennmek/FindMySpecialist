
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
  const booking = verifiedUrl(
    provider.bookingUrl,
    provider.bookingVerified
  );

  const profile = verifiedUrl(
    provider.providerUrl,
    provider.providerVerified
  );

  const action = document.createElement('p');

  if (booking || profile) {
    const link = document.createElement('a');
    link.href = booking || profile;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    link.textContent = booking
      ? 'Book Appointment'
      : 'View Provider Profile';

    action.append(link);
  } else {
    action.textContent = 'No booking link — unverified';
  }

  parent.append(action);
}

const $ = id => document.getElementById(id);

async function requestJson(url) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error || data.message || 'Request failed.'
    );
  }

  return data;
}

function appendText(parent, tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}

async function initialize() {
  const auth = await requestJson('/api/auth/me');

  if (!['Guest', 'Login'].includes(auth.accessType)) {
    location.replace('/index.html?authRequired=1');
    return;
  }

  const params = new URLSearchParams(location.search);
  const id = params.get('id');

  if (!id) {
    throw new Error(
      'Choose a provider from Find Specialists.'
    );
  }

  const selection = new URLSearchParams({
    insurerId: params.get('insurerId') || '',
    planId: params.get('planId') || ''
  });

  const provider = await requestJson(
    `/api/providers/${encodeURIComponent(id)}?${selection}`
  );

  const details = $('providerDetails');

  for (const [label, value] of [
    ['Name', provider.name],
    ['Specialty', provider.specialty],
    ['Clinic', provider.clinic],
    [
      'Location',
      [provider.location, provider.zip]
        .filter(Boolean)
        .join(' ')
    ],
    ['Phone', provider.phone]
  ]) {
    appendText(
      details,
      'p',
      `${label}: ${value || 'Not provided'}`
    );
  }

  const insurance = $('insuranceDetails');

  appendText(
    insurance,
    'p',
    provider.insuranceStatus ||
      'Insurance information unavailable'
  );

  for (const listing of provider.insuranceListings ?? []) {
    const row = document.createElement('p');

    row.append(
      document.createTextNode(
        [
          listing.insurer,
          listing.exactPlanName,
          listing.planType,
          listing.description
        ].filter(Boolean).join(' · ') ||
          'Published insurance information'
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

    insurance.append(row);
  }

  // Updated verified-link behavior.
  addProviderLink(details, provider);

  const backParams = new URLSearchParams(params);
  backParams.delete('id');

  $('backToResults').href =
    `/specialists.html?${backParams}`;
}

initialize().catch(error => {
  const message = $('message');
  message.textContent = error.message;
  message.className = 'notice error';
});
