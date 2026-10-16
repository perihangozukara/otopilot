'use strict';

const { fetchBinary } = require('./helpers');

// Anahtar (Bearer) yalniz bu sabit adreslere gider; ayar dosyasi elle bozulsa bile baska hosta gitmez.
const ENDPOINTLER = [
  'https://api.stability.ai/v2beta/stable-image/generate/core',
  'https://api.stability.ai/v2beta/stable-image/generate/ultra',
  'https://api.stability.ai/v2beta/stable-image/generate/sd3',
];

module.exports = {
  id: 'stability',
  label: 'Stability AI (Stable Image)',
  dialect: 'sdxl',
  docs: 'https://platform.stability.ai/docs/api-reference',
  blurb: 'Seed ve negatif prompt destekler; tutarlilik icin iyi bir denge.',
  supportsReference: false,
  referenceMode: 'none',
  cost: 'kredili',
  costNote: 'Kredi paketiyle calisir.',
  pricingUrl: 'https://platform.stability.ai/pricing',
  realism: 'orta',
  realismNote: 'Seed ve negatif prompt birlikte calisir; tutarlilik icin dengeli.',
  maxResolution: '1536x1536',
  resolutionNote: '',
  setup: 'anahtar',
  setupNote: 'Yalnizca API anahtari yapistirilir.',
  supportsSeed: true,
  supportsNegative: true,
  needs: 'Sadece API anahtari',
  keyUrl: 'https://platform.stability.ai/account/keys',
  fields: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      help: 'platform.stability.ai > API Keys.',
    },
    {
      key: 'endpoint',
      label: 'Uc nokta',
      type: 'select',
      options: ENDPOINTLER,
      default: ENDPOINTLER[0],
    },
  ],

  async generate({ config, prompt, negative, seed, aspectRatio }) {
    if (!config.apiKey) throw new Error('Stability API Key girilmemis.');
    const endpoint = config.endpoint || ENDPOINTLER[0];
    if (!ENDPOINTLER.includes(endpoint)) {
      throw new Error('Gecersiz Stability uc noktasi. Ayarlardan listedeki adreslerden birini sec.');
    }

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('output_format', 'png');
    form.append('aspect_ratio', aspectRatio || '4:5');
    if (negative) form.append('negative_prompt', negative);
    if (seed != null) form.append('seed', String(seed));

    const buffer = await fetchBinary(
      endpoint,
      {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${config.apiKey}`,
          'accept': 'image/*',
        },
        body: form,
      }
    );

    return { images: [{ buffer, mime: 'image/png' }], raw: {} };
  },
};
