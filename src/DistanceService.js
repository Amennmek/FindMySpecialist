
const zipCoordinates = require('./data/zipCoordinates.json');

const GEOCODER_URL =
  'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates';

const STATE_CODES = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR',
  CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI',
  IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS',
  KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS',
  MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM',
  'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND',
  OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT',
  VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY'
};

class AddressLookupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AddressLookupError';
    this.code = code;
  }
}

class DistanceService {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
  }

  async geocodeLocation(location) {
    return this.geocode(location, false);
  }

  async geocodeAddress(address) {
    return this.geocode(address, true);
  }

  async geocode(location, includeStreet) {
    const body = new URLSearchParams({
      SingleLine: [
        ...(includeStreet ? [location.street] : []),
        location.city,
        location.state,
        location.zip
      ].filter(Boolean).join(', '),
      outFields: 'Addr_type,Match_addr,City,Region,Postal',
      f: 'json',
      maxLocations: '10'
    });

    let response;

    try {
      response = await this.fetchImpl(GEOCODER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body,
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      throw new AddressLookupError(
        'GEOCODER_UNAVAILABLE',
        'Address verification is temporarily unavailable. Try again.'
      );
    }

    if (!response.ok) {
      throw new AddressLookupError(
        'GEOCODER_UNAVAILABLE',
        'Address verification is temporarily unavailable. Try again.'
      );
    }

    let data;

    try {
      data = await response.json();
    } catch {
      throw new AddressLookupError(
        'GEOCODER_UNAVAILABLE',
        'Address verification returned an invalid response. Try again.'
      );
    }

    const candidates = (data.candidates ?? []).filter(item =>
      item?.location &&
      Number.isFinite(item.location.x) &&
      Number.isFinite(item.location.y)
    );

    if (!candidates.length) {
      throw new AddressLookupError(
        'ADDRESS_NOT_FOUND',
        includeStreet
          ? 'We could not match that street address. Check the spelling, city, state, and ZIP.'
          : 'We could not match that state and ZIP code. Check them and try again.'
      );
    }

    const normalizedState = value =>
      STATE_CODES[String(value ?? '').trim().toUpperCase()] ??
      String(value ?? '').trim().toUpperCase();

    const normalizedZip = value =>
      String(value ?? '').trim().match(/\b\d{5}\b/)?.[0] ?? '';

    const candidateMatches = item => {
      const attributes = item.attributes ?? {};

      return (
        normalizedState(attributes.Region) ===
          normalizedState(location.state) &&
        normalizedZip(attributes.Postal) ===
          normalizedZip(location.zip)
      );
    };

    // Examine all candidates instead of only the first.
    const candidate = candidates.find(candidateMatches);

    if (!candidate) {
      throw new AddressLookupError(
        'ADDRESS_MISMATCH',
        'No geocoding result matched the state and ZIP entered. Check the full address and ZIP.'
      );
    }

    const attributes = candidate.attributes ?? {};

    const matchedState = normalizedState(attributes.Region);
    const matchedZip = normalizedZip(attributes.Postal);

    // City is descriptive input, not an exact-match constraint.
    // The geocoder may label a ZIP area with a neighboring city.
    // State and ZIP must still match.

    // Only require street-level accuracy when a street is supplied.
    if (
      includeStreet &&
      attributes.Addr_type &&
      ![
        'PointAddress',
        'Subaddress',
        'StreetAddress',
        'StreetInt',
        'StreetName'
      ].includes(attributes.Addr_type)
    ) {
      throw new AddressLookupError(
        'ADDRESS_NOT_FOUND',
        'Only an approximate area was found. Enter a complete street address.'
      );
    }

    return {
      latitude: candidate.location.y,
      longitude: candidate.location.x,
      matchedAddress: attributes.Match_addr ?? candidate.address,
      state: matchedState,
      zip: matchedZip
    };
  }

  async milesBetweenAddresses(origin, destination) {
    // Use ZIP-area coordinates for provider distance calculations.
    const zip = String(destination.zip ?? '')
      .match(/\b\d{5}\b/)?.[0];

    const point = zip && zipCoordinates[zip];

    if (point) {
      return this.straightLineMiles(origin, point);
    }

    // If the ZIP is missing locally, use ArcGIS.
    const approximate = await this.geocodeLocation({
      state: destination.state,
      zip: destination.zip
    });

    return this.straightLineMiles(origin, approximate);
  }

  straightLineMiles(from, to) {
    const radians = degrees =>
      degrees * Math.PI / 180;

    const latitudeDelta =
      radians(to.latitude - from.latitude);

    const longitudeDelta =
      radians(to.longitude - from.longitude);

    const a =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;

    return (
      2 *
      3958.76 *
      Math.asin(Math.sqrt(Math.min(1, a)))
    );
  }
}

DistanceService.AddressLookupError = AddressLookupError;

module.exports = DistanceService;
