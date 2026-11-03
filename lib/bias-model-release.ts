import artifact from './data/bias-model.json';
import {parseBiasModel} from './bias-model';

// Replaced only by an offline reviewed real-data artifact. No key or API required.
export const releasedBiasModel=parseBiasModel(artifact);
