import { api } from '../services/api.js';
import { openModal, toast } from './ui.js';
import { esc } from '../utils/format.js';
import { equipmentTypeOptions } from '../utils/constants.js';

export function openTicketEditModal(t, onSaved) {
  const m = openModal({
    title: `Edit Ticket — ${t.number}`, size: 'lg',
    body: `
      <div class="space-y-4">
        <div><label class="label">Masalah *</label><input id="ed-problem" class="input" value="${esc(t.problem)}"></div>
        <div><label class="label">Deskripsi</label><textarea id="ed-desc" class="input">${esc(t.description || '')}</textarea></div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div><label class="label">Jenis Service</label>
            <select id="ed-type" class="input">
              ${['Repair', 'Preventive Maintenance', 'Installation', 'Inspection', 'Emergency'].map((s) => `<option ${s === t.service_type ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div><label class="label">Prioritas</label>
            <select id="ed-priority" class="input">
              ${['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => `<option ${p === t.priority ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div><label class="label">Jenis Equipment</label>
            <select id="ed-eqtype" class="input"><option value="">-</option>${equipmentTypeOptions(t.equipment_type || '')}</select>
          </div>
          <div><label class="label">Merk / Tipe</label><input id="ed-brand" class="input" value="${esc(t.equipment_brand || '')}"></div>
        </div>
        <div><label class="label">Alamat Service</label><textarea id="ed-address" class="input !min-h-[4rem]">${esc(t.service_address || '')}</textarea></div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div><label class="label">Tanggal Preferensi</label><input id="ed-date" type="date" class="input" value="${t.preferred_date || ''}"></div>
          <div><label class="label">Waktu Preferensi</label><input id="ed-time" class="input" value="${esc(t.preferred_time || '')}" placeholder="cth: 09:00 - 12:00"></div>
        </div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div><label class="label">Nama Kontak</label><input id="ed-contact" class="input" value="${esc(t.contact_name || '')}"></div>
          <div><label class="label">Telepon Kontak</label><input id="ed-phone" class="input" value="${esc(t.contact_phone || '')}"></div>
        </div>
      </div>`,
    footer: `<button class="btn-secondary" data-modal-close>Batal</button><button id="ed-submit" class="btn-primary">Simpan Perubahan</button>`
  });
  m.el.querySelector('#ed-submit').addEventListener('click', async () => {
    const body = {
      problem: m.el.querySelector('#ed-problem').value.trim(),
      description: m.el.querySelector('#ed-desc').value.trim(),
      service_type: m.el.querySelector('#ed-type').value,
      priority: m.el.querySelector('#ed-priority').value,
      equipment_type: m.el.querySelector('#ed-eqtype').value,
      equipment_brand: m.el.querySelector('#ed-brand').value.trim(),
      service_address: m.el.querySelector('#ed-address').value.trim(),
      preferred_date: m.el.querySelector('#ed-date').value,
      preferred_time: m.el.querySelector('#ed-time').value.trim(),
      contact_name: m.el.querySelector('#ed-contact').value.trim(),
      contact_phone: m.el.querySelector('#ed-phone').value.trim()
    };
    if (!body.problem) return toast('Masalah wajib diisi', 'error');
    try {
      await api.put('/api/tickets/' + t.id, body);
      m.close();
      toast('Ticket diperbarui');
      if (onSaved) onSaved();
    } catch (e) { toast(e.message, 'error'); }
  });
}
