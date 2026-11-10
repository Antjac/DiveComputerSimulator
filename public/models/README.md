# 3D models / Modèles 3D

## diver.glb

- **Title / Titre :** Diver
- **Author / Auteur :** ucdavisterc — https://sketchfab.com/ucdavisterc
- **Source :** https://sketchfab.com/3d-models/diver-9a415258dec4449c9faf28f11a5b6831
- **Licence :** Creative Commons Attribution 4.0 (CC BY 4.0) — https://creativecommons.org/licenses/by/4.0/
- **Downloaded / Téléchargé :** 2026-10-29, Sketchfab GLB export, file unchanged / fichier non modifié.
- **Changes made when loading / Modifications au chargement** (`src/ui/scene3d/models.ts`, `loadDiverModel`):
  the animation tracks of the arms, hands and neck are dropped (the diver kicks with the legs only) and the arms are posed (shoulders and elbows turned) with the hands crossed in front, under the chin, each hand gripping the other forearm (shoulders, elbows, wrists and fingers turned: `poseArms`);
  the KHR_materials_pbrSpecularGlossiness materials are converted (diffuse texture and colour,
  roughness from glossiness); a stray plane of the original scene is hidden. /
  les pistes d'animation des bras, des mains et du cou sont retirées (le plongeur palme avec les jambes
  seulement) et les bras sont placés (épaules et coudes tournés) mains croisées devant, sous le menton, chaque main serrant l'autre avant-bras (épaules, coudes, poignets et doigts tournés : `poseArms`) ; les matériaux KHR_materials_pbrSpecularGlossiness sont convertis (texture et couleur
  diffuses, rugosité tirée de la brillance) ; un plan parasite de la scène d'origine est masqué.
