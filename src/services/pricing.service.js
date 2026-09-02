// services/pricing.service.js
const axios = require('axios');

// ─── Tarifs de base ────────────────────────────────────────────────────────
const TARIF_PAR_M3        = 45;    // €/m³
const TARIF_PAR_KM        = 1.50;  // €/km
const KM_OFFERTS          = 30;    // premiers km gratuits
const MAJORATION_WEEKEND  = 0.15;  // +15%
const MAJORATION_ETE      = 0.15;  // +15% juillet/août
const FRAIS_APPARTEMENT   = 50;    // € fixes
const TVA                 = 0.20;  // 20%

// ─── Appel Réel à l'API Google Maps Distance Matrix ────────────────────────
const getDistanceKm = async (villeDepart, villeArrivee) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.warn(" [Pricing Service] GOOGLE_MAPS_API_KEY manquante dans le .env. Distance par défaut de 300km appliquée.");
    return 300; 
  }

  // Si le départ et l'arrivée sont identiques, pas de distance
  if (villeDepart.toLowerCase().trim() === villeArrivee.toLowerCase().trim()) {
    return 0;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(villeDepart)}&destinations=${encodeURIComponent(villeArrivee)}&key=${apiKey}&region=fr`;
    
    const response = await axios.get(url);
    const data = response.data;

    // Vérification de la validité de la réponse Google
    if (data.status === 'OK' && data.rows[0].elements[0].status === 'OK') {
      const distanceEnMetres = data.rows[0].elements[0].distance.value;
      const distanceEnKm = Math.round(distanceEnMetres / 1000); // Conversion mètres -> km
      return distanceEnKm;
    } else {
      console.error("❌ [Google Maps API] Statut invalide reçu :", data.status, data.rows[0]?.elements[0]?.status);
      return 300; // Repli de sécurité si la ville n'est pas trouvée
    }
  } catch (error) {
    console.error("❌ [Google Maps API] Échec de la requête réseau :", error.message);
    return 300; // Repli de sécurité en cas de panne réseau ou API
  }
};

// ─── Détection week-end / été ──────────────────────────────────────────────
const isWeekend = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  return day === 0 || day === 6; 
};

const isEte = (date) => {
  const d = new Date(date);
  const month = d.getMonth() + 1; 
  return month === 7 || month === 8; 
};

// ─── SERVICE PRINCIPAL ─────────────────────────────────────────────────────
const calculerPrix = async ({ ville_depart, ville_arrivee, volume, date_demenagement, type_logement }) => {

  // 1. Validation des entrées
  const erreurs = [];
  if (!ville_depart)       erreurs.push('ville_depart manquante');
  if (!ville_arrivee)      erreurs.push('ville_arrivee manquante');
  if (!volume)             erreurs.push('volume manquant');
  if (!date_demenagement)  erreurs.push('date_demenagement manquante');
  if (!type_logement)      erreurs.push('type_logement manquant');
  if (erreurs.length)      throw new Error(`Données insuffisantes : ${erreurs.join(', ')}`);

  const volumeM3 = parseFloat(String(volume).replace(/[^0-9.,]/g, '').replace(',', '.'));
  if (isNaN(volumeM3) || volumeM3 <= 0) throw new Error('Volume invalide.');

  // 2. Prix volume
  const prix_volume = Math.round(volumeM3 * TARIF_PAR_M3 * 100) / 100;

  // 3. Prix distance (Appel à la vraie API Google Maps)
  const distanceTotale = await getDistanceKm(ville_depart, ville_arrivee);
  const distanceFacturee = Math.max(0, distanceTotale - KM_OFFERTS);
  const prix_distance    = Math.round(distanceFacturee * TARIF_PAR_KM * 100) / 100;

  // 4. Frais de manutention
  const isAppartement  = type_logement?.toLowerCase().includes('appartement') || type_logement?.toLowerCase().includes('t1') || type_logement?.toLowerCase().includes('t2') || type_logement?.toLowerCase().includes('t3') || type_logement?.toLowerCase().includes('t4') || type_logement?.toLowerCase().includes('studio');
  const frais_manutention = isAppartement ? FRAIS_APPARTEMENT : 0;

  // 5. Sous-total HT avant majorations
  const sous_total_base = prix_volume + prix_distance + frais_manutention;

  // 6. Majorations
  const date     = new Date(date_demenagement);
  const weekend  = isWeekend(date);
  const ete      = isEte(date);
  const taux_majoration = (weekend ? MAJORATION_WEEKEND : 0) + (ete ? MAJORATION_ETE : 0);
  const montant_majoration = Math.round(sous_total_base * taux_majoration * 100) / 100;

  const raisons_majoration = [];
  if (weekend) raisons_majoration.push('Week-end (+15%)');
  if (ete)     raisons_majoration.push('Haute saison juillet/août (+15%)');

  // 7. Sous-total HT
  const sous_total_ht = Math.round((sous_total_base + montant_majoration) * 100) / 100;

  // 8. TVA + TTC
  const montant_tva   = Math.round(sous_total_ht * TVA * 100) / 100;
  const prix_total_ttc = Math.round((sous_total_ht + montant_tva) * 100) / 100;

  // 9. Retour JSON détaillé
  return {
    ville_depart,
    ville_arrivee,
    volume      : `${volumeM3}m³`,
    date_demenagement,
    type_logement,

    detail: {
      prix_volume       : { montant: prix_volume,        description: `${volumeM3}m³ × ${TARIF_PAR_M3}€/m³` },
      prix_distance     : { montant: prix_distance,      description: `${distanceTotale}km (${KM_OFFERTS}km offerts) × ${TARIF_PAR_KM}€/km`, distance_km: distanceTotale },
      frais_manutention : { montant: frais_manutention,  description: isAppartement ? 'Forfait appartement/étage' : 'Inclus' },
      sous_total_base   : { montant: sous_total_base,    description: 'Sous-total avant majorations' },
      majorations       : { montant: montant_majoration, taux: `${Math.round(taux_majoration * 100)}%`, raisons: raisons_majoration },
      sous_total_ht     : { montant: sous_total_ht,      description: 'Sous-total HT' },
      tva               : { montant: montant_tva,        taux: '20%' },
    },

    prix_total_ttc,
    devise     : 'EUR',
    calcule_le : new Date().toISOString(),
  };
};

module.exports = { calculerPrix };