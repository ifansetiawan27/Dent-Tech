'use strict';
// Definisi checklist template per jenis equipment dental.
// Dipakai oleh seed.js untuk mengisi Checklist Library.

const COMMON_SAFETY = [
  { label: 'Periksa kondisi kabel dan steker listrik', required: true },
  { label: 'Periksa grounding / arde unit', required: true },
  { label: 'Periksa tombol emergency stop (bila ada)', required: false },
  { label: 'Pastikan tidak ada kebocoran arus / panas berlebih', required: true }
];
const COMMON_FINAL = [
  { label: 'Bersihkan area kerja setelah selesai', required: true },
  { label: 'Konfirmasi unit berfungsi normal', required: true },
  { label: 'Serahkan hasil kerja ke customer', required: true }
];

function tpl(name, category, sections) {
  return { name, service_type: 'Preventive Maintenance', equipment_category: category, version: '1.0', sections };
}

const CHECKLIST_TEMPLATES = [
  tpl('Dental Unit', 'Dental Unit', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi upholstery / jok kursi', required: true },
      { label: 'Periksa gerakan naik-turun kursi (hidrolik)', required: true },
      { label: 'Periksa reclining backrest & headrest', required: true },
      { label: 'Periksa handpiece holder & tray instrument', required: true } ] },
    { section: 'Pneumatik & Air', items: [
      { label: 'Periksa tekanan udara kompresor ke unit', required: true },
      { label: 'Periksa tekanan water supply & suction', required: true },
      { label: 'Periksa kebocoran selang udara/air', required: true },
      { label: 'Bersihkan filter suction & saliva ejector', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan & disinfeksi seluruh permukaan unit', required: true },
      { label: 'Bersihkan spittoon & sistem kumur', required: true },
      { label: 'Lumasi moving parts / engsel', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji semua gerakan kursi (naik/turun/recline)', required: true },
      { label: 'Uji handpiece (high & low speed) berputar normal', required: true },
      { label: 'Uji lampu operasi / operating lamp', required: true },
      { label: 'Uji foot controller berfungsi', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Compressor', 'Compressor', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi tabung & sambungan', required: true },
      { label: 'Periksa mounting / dudukan unit', required: true } ] },
    { section: 'Perawatan', items: [
      { label: 'Kuras air trap / drain tabung', required: true },
      { label: 'Bersihkan/ganti filter udara', required: true },
      { label: 'Periksa level & kondisi oli (oil-free/oil-lub)', required: true },
      { label: 'Periksa V-belt / kopling (bila ada)', required: false } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji tekanan output sesuai spesifikasi', required: true },
      { label: 'Uji pressure switch cut-in / cut-out', required: true },
      { label: 'Uji safety valve / relief valve', required: true },
      { label: 'Periksa suara & getaran abnormal', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Motor Suction', 'Motor Suction', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi bodi & selang suction', required: true },
      { label: 'Periksa koneksi ke dental unit', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan filter & separator', required: true },
      { label: 'Bersihkan impeller / ruang hisap', required: true },
      { label: 'Periksa & bersihkan container penampung', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji daya hisap (vacuum) normal', required: true },
      { label: 'Uji motor berputar tanpa suara abnormal', required: true },
      { label: 'Periksa arus motor sesuai spesifikasi', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Autoclave', 'Autoclave', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa seal & gasket pintu', required: true },
      { label: 'Periksa mekanisme pengunci pintu', required: true },
      { label: 'Periksa kondisi chamber', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan chamber & tray', required: true },
      { label: 'Bersihkan filter drain', required: true },
      { label: 'Ganti dengan distilled water', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji siklus sterilisasi berjalan', required: true },
      { label: 'Verifikasi suhu mencapai 134°C', required: true },
      { label: 'Verifikasi tekanan mencapai ~2.1 bar', required: true },
      { label: 'Uji katup relief tekanan', required: true },
      { label: 'Verifikasi indikator sterilisasi valid', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Sterilisator UV', 'Sterilisator UV', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi lampu UV', required: true },
      { label: 'Periksa reflektor & ruang sterilisasi', required: true },
      { label: 'Periksa pintu & interlock', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan permukaan lampu UV', required: true },
      { label: 'Bersihkan rak & interior', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji lampu UV menyala normal', required: true },
      { label: 'Uji timer sterilisasi berfungsi', required: true },
      { label: 'Verifikasi intensitas UV memadai', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Handpiece', 'Handpiece', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi bodi & kepala handpiece', required: true },
      { label: 'Periksa chuck / bur holder', required: true },
      { label: 'Periksa konektor ke selang unit', required: true } ] },
    { section: 'Perawatan', items: [
      { label: 'Bersihkan & lubrikasi bearing', required: true },
      { label: 'Ganti bearing / rotor bila aus', required: false },
      { label: 'Ganti O-ring / seal', required: false } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji putaran (RPM) sesuai spesifikasi', required: true },
      { label: 'Uji suara putaran halus / tanpa getaran', required: true },
      { label: 'Uji semprotan air (water spray)', required: true },
      { label: 'Uji bur tercekam kuat', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Scaller', 'Scaller', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi handpiece scaller', required: true },
      { label: 'Periksa tip / insert scaller', required: true },
      { label: 'Periksa kabel & konektor', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan & sterilkan tip', required: true },
      { label: 'Bersihkan handpiece', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji getaran ultrasonik normal', required: true },
      { label: 'Uji semprotan air pendingin', required: true },
      { label: 'Uji pengaturan daya berfungsi', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Lightcure', 'Lightcure', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi light guide / fiber', required: true },
      { label: 'Periksa bodi & pegangan', required: true },
      { label: 'Periksa lensa output', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan lensa & light guide', required: true },
      { label: 'Bersihkan bodi unit', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji intensitas cahaya (radiometer)', required: true },
      { label: 'Uji timer curing berfungsi', required: true },
      { label: 'Uji mode operasi (ramp/boost)', required: false },
      { label: 'Verifikasi panjang gelombang sesuai', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Aerosol', 'Aerosol', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi handpiece aerosol', required: true },
      { label: 'Periksa tabung & selang', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan nozzle & saluran', required: true },
      { label: 'Bersihkan bodi unit', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji semprotan aerosol merata', required: true },
      { label: 'Uji tekanan udara normal', required: true },
      { label: 'Uji katup on/off berfungsi', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Microscope', 'Microscope', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa lensa objektif & okuler', required: true },
      { label: 'Periksa mekanisme fokus & stage', required: true },
      { label: 'Periksa lengan & dudukan', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan lensa dengan cairan khusus', required: true },
      { label: 'Bersihkan stage & bodi', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji fokus halus & kasar', required: true },
      { label: 'Uji pembesaran (magnification)', required: true },
      { label: 'Uji iluminasi / lampu', required: true },
      { label: 'Uji kamera/monitor (bila ada)', required: false } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Laser', 'Laser', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi handpiece & fiber optik', required: true },
      { label: 'Periksa bodi & panel kontrol', required: true },
      { label: 'Periksa sistem pendingin', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan ujung fiber / tip', required: true },
      { label: 'Bersihkan lensa & bodi', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji output laser (test fire)', required: true },
      { label: 'Verifikasi kalibrasi daya', required: true },
      { label: 'Uji interlock & safety switch', required: true },
      { label: 'Uji mode & parameter operasi', required: true } ] },
    { section: 'Keselamatan', items: [
      { label: 'Periksa kacamata pelindung laser tersedia', required: true },
      { label: 'Verifikasi label peringatan laser', required: true } ].concat(COMMON_SAFETY) },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Surgery Device', 'Surgery Device', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi unit & aksesori', required: true },
      { label: 'Periksa handpiece surgery', required: true },
      { label: 'Periksa kabel & konektor', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan & sterilkan handpiece', required: true },
      { label: 'Bersihkan bodi unit', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji putaran / torsi sesuai spesifikasi', required: true },
      { label: 'Uji irigasi pendingin', required: true },
      { label: 'Uji pengaturan kecepatan', required: true },
      { label: 'Uji mode operasi (forward/reverse)', required: false } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Electric Micromotor', 'Electric Micromotor', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi motor & handpiece', required: true },
      { label: 'Periksa kabel & konektor', required: true },
      { label: 'Periksa coupling ke unit', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan & lubrikasi motor', required: true },
      { label: 'Bersihkan handpiece', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji putaran (RPM) stabil', required: true },
      { label: 'Uji torsi memadai', required: true },
      { label: 'Uji kontrol kecepatan', required: true },
      { label: 'Periksa suara & getaran abnormal', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Endomotor', 'Endomotor', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi handpiece endo', required: true },
      { label: 'Periksa kabel & konektor', required: true },
      { label: 'Periksa baterai (cordless)', required: false } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan & sterilkan handpiece', required: true },
      { label: 'Bersihkan bodi unit', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji putaran & torsi endo', required: true },
      { label: 'Uji mode reciprocating/rotary', required: true },
      { label: 'Uji apex locator integration (bila ada)', required: false },
      { label: 'Uji pengaturan parameter', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Apex Locator', 'Apex Locator', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi unit & probe', required: true },
      { label: 'Periksa kabel file clip & lip hook', required: true },
      { label: 'Periksa layar display', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan probe & aksesori', required: true },
      { label: 'Bersihkan bodi unit', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji akurasi pembacaan apex', required: true },
      { label: 'Uji kalibrasi dengan test resistor', required: true },
      { label: 'Uji indikator visual & suara', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Water Distiller', 'Water Distiller', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi chamber & kondensor', required: true },
      { label: 'Periksa tabung penampung', required: true },
      { label: 'Periksa kabel & konektor', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan chamber dari kerak', required: true },
      { label: 'Bersihkan/ganti filter karbon', required: true },
      { label: 'Bersihkan kondensor', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji siklus distilasi berjalan', required: true },
      { label: 'Verifikasi kualitas air hasil (TDS)', required: true },
      { label: 'Uji elemen pemanas', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Sealing Machine', 'Sealing Machine', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi elemen pemanas/seal bar', required: true },
      { label: 'Periksa roller / penjepit', required: true },
      { label: 'Periksa bodi & kabel', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan seal bar / elemen', required: true },
      { label: 'Bersihkan area kerja unit', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji suhu sealing tercapai', required: true },
      { label: 'Uji hasil seal rapat & merata', required: true },
      { label: 'Uji timer / tekanan seal', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('IO (Intraoral Camera)', 'IO (Intraoral Camera)', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi kamera & lensa', required: true },
      { label: 'Periksa kabel & konektor', required: true },
      { label: 'Periksa handpiece kamera', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan lensa kamera', required: true },
      { label: 'Bersihkan bodi & sleeve', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji gambar tampil di monitor', required: true },
      { label: 'Uji fokus & zoom', required: true },
      { label: 'Uji LED iluminasi', required: true },
      { label: 'Uji capture / freeze image', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('X-Ray', 'X-Ray', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa tube head & lengan', required: true },
      { label: 'Periksa kolimator & cone', required: true },
      { label: 'Periksa panel kontrol', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji eksposur / firing normal', required: true },
      { label: 'Verifikasi kV & mA sesuai setting', required: true },
      { label: 'Uji timer eksposur akurat', required: true },
      { label: 'Uji sensor/gambar hasil (digital/film)', required: true } ] },
    { section: 'Keselamatan Radiasi', items: [
      { label: 'Verifikasi tidak ada kebocoran radiasi', required: true },
      { label: 'Periksa apron timbal tersedia', required: true },
      { label: 'Verifikasi label & peringatan radiasi', required: true },
      { label: 'Uji interlock & indikator eksposur', required: true } ] },
    { section: 'Keselamatan Listrik', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('Intraoral Scanner 3D', 'Intraoral Scanner 3D', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi scanner & lensa', required: true },
      { label: 'Periksa kabel & konektor', required: true },
      { label: 'Periksa tip / sleeve scanner', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan lensa & jendela optik', required: true },
      { label: 'Bersihkan bodi scanner', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji proses scanning berjalan', required: true },
      { label: 'Verifikasi akurasi hasil scan', required: true },
      { label: 'Uji kalibrasi scanner', required: true },
      { label: 'Uji koneksi ke software', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ]),

  tpl('3D Printer', '3D Printer', [
    { section: 'Pemeriksaan Fisik', items: [
      { label: 'Periksa kondisi build platform', required: true },
      { label: 'Periksa resin tank / vat', required: true },
      { label: 'Periksa sistem gerak (axis)', required: true } ] },
    { section: 'Pembersihan', items: [
      { label: 'Bersihkan build platform', required: true },
      { label: 'Bersihkan / ganti FEP film', required: false },
      { label: 'Bersihkan area print', required: true } ] },
    { section: 'Pengujian Fungsi', items: [
      { label: 'Uji proses printing berjalan', required: true },
      { label: 'Verifikasi kalibrasi platform', required: true },
      { label: 'Uji curing UV / laser', required: true },
      { label: 'Verifikasi hasil print akurat', required: true } ] },
    { section: 'Keselamatan', items: COMMON_SAFETY },
    { section: 'Final Inspection', items: COMMON_FINAL }
  ])
];

module.exports = { CHECKLIST_TEMPLATES };
