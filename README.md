
### ZIP-area provider search (November 2026)
Find Specialists uses state, ZIP and radius (not provider city). The ZIP radius is based on approximate ZIP centroids. The repository queries NPPES using three-digit postal-code prefix wildcards for nearby ZIPs, with pagination up to 1,000 records per taxonomy/prefix. It then checks each provider's actual five-digit practice ZIP and calculated distance. NPPES search result limits mean this is not guaranteed exhaustive. The state/ZIP geocoder validates the starting area; ArcGIS is required for that step. NPPES insurance acceptance is not verified.

## City, state, and ZIP search (updated)
Both Intake and Find accept city, state, and ZIP. The city is sent to ArcGIS for location validation; providers in other cities may still qualify based on distance. NPPES queries use specialty, state, and postal-code prefixes derived from the ZIP-coordinate cache. Provider ZIPs missing from the cache are no longer automatically excluded: their approximate coordinates are resolved on demand for radius filtering.

