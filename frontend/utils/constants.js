export const EQUIPMENT_TYPES = [
  'Dental Unit',
  'Compressor',
  'Motor Suction',
  'Autoclave',
  'Sterilisator UV',
  'Handpiece',
  'Scaller',
  'Lightcure',
  'Aerosol',
  'Microscope',
  'Laser',
  'Surgery Device',
  'Electric Micromotor',
  'Endomotor',
  'Apex Locator',
  'Water Distiller',
  'Sealing Machine',
  'IO (Intraoral Camera)',
  'X-Ray',
  'Intraoral Scanner 3D',
  '3D Printer'
];

export function equipmentTypeOptions(selected = '') {
  return EQUIPMENT_TYPES
    .map((t) => `<option value="${t}" ${t === selected ? 'selected' : ''}>${t}</option>`)
    .join('');
}
