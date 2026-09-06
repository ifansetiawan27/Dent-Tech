import { fmtIDR, formatIDRInput, parseIDR, bindIDRInput, esc } from '../utils/format.js';
import { refreshIcons } from './ui.js';

// Editor "Item Tambahan" yang dipakai bersama oleh modal Buat Proforma
// (workorder-detail) dan Edit Invoice (invoice-detail).
export function setupInvoiceItemsEditor(wrapEl, initialItems = []) {
  let rowNo = 0;

  function addRow(item = {}) {
    const row = document.createElement('div');
    row.className = 'invoice-item-row rounded-xl border border-slate-200 p-3';
    row.dataset.row = String(++rowNo);
    row.innerHTML = `
      <div class="flex items-start justify-between gap-2 mb-3">
        <p class="text-xs font-semibold text-slate-500">Item Tambahan #${rowNo}</p>
        <button type="button" data-remove class="p-1 text-slate-400 hover:text-red-500"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </div>
      <div class="space-y-3">
        <div><label class="label">Deskripsi *</label><input data-field="description" class="input" maxlength="300" value="${esc(item.description || '')}" placeholder="cth: Biaya transportasi / jasa tambahan"></div>
        <div class="grid grid-cols-3 gap-2">
          <div><label class="label">Qty *</label><input data-field="qty" type="number" min="0.01" step="0.01" class="input" value="${item.qty || 1}"></div>
          <div><label class="label">Satuan</label><input data-field="unit" class="input" maxlength="30" value="${esc(item.unit || 'unit')}"></div>
          <div><label class="label">Harga / unit (Rp)</label><input data-field="unit_price" type="text" inputmode="numeric" class="input" value="${formatIDRInput(item.unit_price || 0)}"></div>
        </div>
        <p data-line-total class="text-xs text-right font-semibold text-slate-600">Jumlah: ${fmtIDR((item.qty || 1) * (item.unit_price || 0))}</p>
      </div>`;
    wrapEl.appendChild(row);
    const price = bindIDRInput(row.querySelector('[data-field="unit_price"]'));
    const qty = row.querySelector('[data-field="qty"]');
    const refreshTotal = () => { row.querySelector('[data-line-total]').textContent = 'Jumlah: ' + fmtIDR((Number(qty.value) || 0) * parseIDR(price.value)); };
    qty.addEventListener('input', refreshTotal);
    price.addEventListener('input', refreshTotal);
    row.querySelector('[data-remove]').addEventListener('click', () => row.remove());
    refreshIcons();
  }

  function collect() {
    return Array.from(wrapEl.querySelectorAll('.invoice-item-row')).map((row) => ({
      description: row.querySelector('[data-field="description"]').value.trim(),
      qty: Number(row.querySelector('[data-field="qty"]').value),
      unit: row.querySelector('[data-field="unit"]').value.trim(),
      unit_price: parseIDR(row.querySelector('[data-field="unit_price"]').value)
    }));
  }

  initialItems.forEach(addRow);
  return { add: addRow, collect };
}
