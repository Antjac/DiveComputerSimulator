import type { DiveComputer } from './base';
import { AqualungI330r } from './aqualung/i330r';
import { AqualungI770r } from './aqualung/i770r';
import { AzothOdyssey } from './azoth/odyssey';
import { GarminDescent } from './garmin';
import { GarminDescentX30 } from './garmin/x30';
import { GarminDescentX50i } from './garmin/x50i';
import { CressiDonatello } from './cressi/donatello';
import { CressiGoa } from './cressi/goa';
import { CressiDaVinci } from './cressi/davinci';
import { MaresPuck } from './mares/puck';
import { MaresGenius } from './mares/genius';
import { MaresQuadAir } from './mares/quadair';
import { MaresQuad2 } from './mares/quad2';
import { MaresQuadCi } from './mares/quadci';
import { ScubaproG2 } from './scubapro/g2';
import { SeacScreen } from './seac/screen';
import { SeacTablet } from './seac/tablet';
import { ScubaproG3 } from './scubapro/g3';
import { ScubaproLuna } from './scubapro/luna';
import { ShearwaterPerdix } from './shearwater/perdix';
import { ShearwaterPeregrine } from './shearwater/peregrine';
import { ShearwaterTeric } from './shearwater/teric';
import { SuuntoD5 } from './suunto/d5';
import { SuuntoEonCore } from './suunto/eoncore';
import { SuuntoNautic } from './suunto/nautic';
import { SuuntoZoopNovo } from './suunto/zoopnovo';

/** Every simulated computer, in alphabetical order of name (the order of the lists and tables). */
export function createComputers(): DiveComputer[] {
  const all = [new ShearwaterPerdix(), new ShearwaterPeregrine(), new ShearwaterTeric(), new GarminDescent(), new GarminDescentX30(), new GarminDescentX50i(), new SuuntoD5(), new SuuntoEonCore(), new MaresPuck(), new MaresQuadCi(), new MaresQuadAir(), new MaresQuad2(), new MaresGenius(), new ScubaproG2(), new ScubaproG3(), new ScubaproLuna(), new CressiGoa(), new CressiDonatello(), new SuuntoZoopNovo(), new SuuntoNautic(), new AqualungI330r(), new AqualungI770r(), new AzothOdyssey(), new SeacScreen(), new SeacTablet(), new CressiDaVinci()];
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

/** Computer shown on a first visit. */
export const DEFAULT_COMPUTER = 'shearwater';

export type { ComputerView } from './base';
export { DiveComputer } from './base';
