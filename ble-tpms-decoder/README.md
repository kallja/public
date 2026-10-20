# BLE TPMS Decoder

A static web page that decodes BLE TPMS frames advertised under Bluetooth company ID `0x022B` (e.g. Autel MX-Sensor BLE) into pressure, temperature and battery. Decoding runs in the browser and nothing is sent anywhere.

It accepts:

- a full advertisement, e.g. `0201060BFF2B0201020A860148EA0B`
- manufacturer data for company ID `0x022B`, with or without the `2B 02` prefix
- a protobuf frame: the `0x05`-prefixed frames seen under company ID `0x022B`, or a GATT `TPData` reply from characteristic `0213`

You can prefill the input with a link such as `…/#hex=0201060BFF2B0201020A860148EA0B`.

## Run locally

```bash
python3 -m http.server 8000
```

## Test

```bash
node --test
```

## Deploy

`.github/workflows/pages.yml` runs the tests and publishes only this folder to GitHub Pages on every push to `main` that touches it. The repo's Pages source must be set to GitHub Actions (Settings → Pages → Source).

## Credits

The decoder logic is ported from the MIT-licensed work of Aliaksandr Anufryieu, which builds on reverse engineering by cunzulatu. The formats are reverse-engineered, so treat the readings as approximate.

## License

MIT; see [LICENSE](LICENSE).
