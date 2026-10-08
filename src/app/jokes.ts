// Divers' jokes, one drawn at random in the boat's speech bubble during a break on board (app/boat.ts),
// like `fortune` on Linux.
import type { Lang } from '../i18n';

export const JOKES: Record<Lang, string>[] = [
  {
    fr: 'Pourquoi les plongeurs basculent-ils en arrière ? Parce qu’en avant, ils tomberaient dans le bateau.',
    en: 'Why do divers roll off backwards? Because forwards, they would fall into the boat.',
  },
  {
    fr: 'Le palier de sécurité : trois minutes pour se demander si on a bien fermé la voiture.',
    en: 'The safety stop: three minutes to wonder whether you locked the car.',
  },
  {
    fr: 'Un plongeur ne ment jamais… sauf sur la taille du mérou.',
    en: 'A diver never lies… except about the size of the grouper.',
  },
  {
    fr: 'Combien faut-il de plongeurs pour changer une ampoule ? Un seul, mais il en parlera pendant tout l’intervalle surface.',
    en: 'How many divers does it take to change a light bulb? One, but they will talk about it for the whole surface interval.',
  },
  {
    fr: 'Le binôme idéal : il a toujours plus d’air que toi, et un masque de rechange.',
    en: 'The perfect buddy: always has more air than you, and a spare mask.',
  },
  {
    fr: 'Pipi dans la combi : tout le monde le fait, personne ne l’avoue.',
    en: 'Peeing in your wetsuit: everyone does it, nobody admits it.',
  },
  {
    fr: 'Le briefing dure dix minutes. Le débriefing, jusqu’à l’apéro.',
    en: 'The briefing lasts ten minutes. The debriefing lasts until happy hour.',
  },
  {
    fr: 'Mon ordinateur dit : pas de palier. Mon moniteur dit : trois minutes. Devine qui gagne.',
    en: 'My computer says: no stop. My instructor says: three minutes. Guess who wins.',
  },
  {
    fr: 'Il y a ceux qui sortent de l’eau avec 100 bar, et ceux qui racontent qu’ils sont sortis avec 100 bar.',
    en: 'Some divers surface with 100 bar left. Others just say they did.',
  },
  {
    fr: 'On a vu un requin ! Enfin, une ombre. Bon, peut-être un gros poisson.',
    en: 'We saw a shark! Well, a shadow. OK, maybe a big fish.',
  },
  {
    fr: 'Le mal de mer, c’est la nature qui te dit de te mettre à l’eau plus vite.',
    en: 'Seasickness is nature telling you to get in the water faster.',
  },
  {
    fr: 'Plongeur : quelqu’un qui dépense une fortune pour regarder des poissons qu’il refuse de manger.',
    en: 'Diver: someone who spends a fortune to look at fish they would never eat.',
  },
  {
    fr: 'Le gilet, c’est simple : un coup trop, tu montes ; un coup pas assez, tu descends ; entre les deux, tu fais des photos.',
    en: 'BCD basics: a puff too much, you go up; not enough, you go down; in between, you take photos.',
  },
];

let last = -1;

/** A joke other than the previous one. */
export function randomJoke(): Record<Lang, string> {
  let i = Math.floor(Math.random() * JOKES.length);
  if (i === last) i = (i + 1) % JOKES.length;
  last = i;
  return JOKES[i];
}
