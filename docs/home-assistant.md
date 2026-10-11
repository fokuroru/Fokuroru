# Home Assistant: latest downloaded chapters

Fokuroru serves the chapters that arrived most recently as JSON, with a cover for each, under the same
read-only token the OPDS catalogue uses. Nothing here can change anything in the library.

## 1. Get a token

In Settings, under OPDS, enable the OPDS catalogue and copy the feed URL, which looks like
`/api/v1/opds/<token>`. The token is the part after `/opds/`. It only opens the catalogue, so it is safe
to put in Home Assistant's `secrets.yaml`:

```yaml
fokuroru_base: http://192.168.1.107:8991
fokuroru_token: PASTE_THE_TOKEN
```

The base URL has to be one your Home Assistant server **and** the browser showing the dashboard can
reach, because the covers are loaded by the browser. The LAN port works at home. `https://comics.grum.us`
also works from outside: `/api/v1/opds` is the one path that skips the sign-in proxy, and the token is
what protects it.

## 2. The endpoint

```
GET {base}/api/v1/opds/{token}/recent.json?limit=10&groupBySeries=true
```

| Parameter | Default | Meaning |
|---|---|---|
| `limit` | 10 | How many entries, 1 to 50. |
| `groupBySeries` | true | One entry per series at its newest chapter, with `newChapters` counting what arrived. Set false for one entry per chapter. |

```json
{
  "generatedAt": "2026-10-11T03:14:07Z",
  "count": 2,
  "items": [
    {
      "seriesId": 139,
      "seriesTitle": "The Cutest Boy is Waiting for Me at Home",
      "chapterId": 9021,
      "chapter": "Ch.12",
      "number": 12,
      "volume": null,
      "language": "en",
      "addedAt": "2026-10-11T02:50:11Z",
      "newChapters": 3,
      "cover": "/api/v1/opds/<token>/cover/139"
    }
  ]
}
```

`cover` is a path. Put your base URL in front of it. It is `null` for a series with no poster.
Re-downloads, repairs and relinked files are not counted as new chapters. A wrong or revoked token, or
a disabled catalogue, answers 404.

### Library totals

```
GET {base}/api/v1/opds/{token}/stats.json
```

```json
{ "generatedAt": "2026-10-11T05:10:00Z", "series": 90, "chapters": 896, "chaptersTracked": 9032,
  "files": 762, "pages": 30729, "bytes": 11680976830 }
```

`chapters` counts chapters that have a file, the same "downloaded" figure the Stats page shows.
`chaptersTracked` also counts chapters a source lists that are not downloaded. `pages` is summed per file,
so a volume file holding several chapters counts once. A wrong token answers 404.

## 3. Home Assistant configuration

```yaml
rest:
  - resource: !secret fokuroru_latest_url   # {base}/api/v1/opds/{token}/recent.json?limit=10
    scan_interval: 600
    sensor:
      - name: Fokuroru latest chapters
        value_template: "{{ value_json.count }}"
        json_attributes:
          - items
          - generatedAt
```

The totals as two sensors, from one request. Add the second URL to `secrets.yaml` as
`fokuroru_stats_url` (`{base}/api/v1/opds/{token}/stats.json`):

```yaml
rest:
  - resource: !secret fokuroru_stats_url
    scan_interval: 3600
    sensor:
      - name: Fokuroru chapters
        unique_id: fokuroru_chapters
        value_template: "{{ value_json.chapters }}"
        unit_of_measurement: chapters
        state_class: total
        json_attributes: [series, chaptersTracked, files, bytes, generatedAt]
      - name: Fokuroru pages
        unique_id: fokuroru_pages
        value_template: "{{ value_json.pages }}"
        unit_of_measurement: pages
        state_class: total
```

A dashboard card that shows the covers, with the cover and title each linking to the series page in Fokuroru (tested on Home Assistant 2026.10). Use an address your browser
can load covers from. `https://comics.grum.us` works at home and away and avoids the mixed-content block
you get when a page served over HTTPS loads an `http://` image:

```yaml
type: markdown
content: |
  {% set items = state_attr('sensor.fokuroru_latest_chapters', 'items') or [] %}
  | | Latest chapters |
  |---|---|
  {% for i in items[:10] %}{% set link = 'https://comics.grum.us/series/' ~ i.seriesId %}| {% if i.cover %}<a href="{{ link }}" target="_blank" rel="noopener"><img src="https://comics.grum.us{{ i.cover }}" width="56"></a>{% endif %} | <a href="{{ link }}" target="_blank" rel="noopener"><b>{{ i.seriesTitle }}</b></a><br>{{ i.chapter }}{% if i.newChapters > 1 %} · +{{ i.newChapters - 1 }} more{% endif %} · {{ relative_time(as_datetime(i.addedAt)) }} ago |
  {% endfor %}
```

The newest cover as an `image` entity, for picture cards and automations:

```yaml
template:
  - image:
      - name: Fokuroru newest cover
        url: >
          {% set items = state_attr('sensor.fokuroru_latest_chapters', 'items') or [] %}
          {{ ('http://192.168.1.107:8991' ~ items[0].cover) if items and items[0].cover else none }}
```

An automation can fire when `sensor.fokuroru_latest_chapters` gets a new first item. Compare
`items[0].chapterId` between updates.
