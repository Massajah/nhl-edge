const NHL_LOGO_BASE_URL = 'https://assets.nhle.com/logos/nhl/svg'

const buildNhlLogoUrl = (abbreviation) =>
  `${NHL_LOGO_BASE_URL}/${abbreviation}_light.svg`

export const TEAM_METADATA_BY_ABBREVIATION = {
  ANA: { logo: buildNhlLogoUrl('ANA') },
  BOS: { logo: buildNhlLogoUrl('BOS') },
  BUF: { logo: buildNhlLogoUrl('BUF') },
  CGY: { logo: buildNhlLogoUrl('CGY') },
  CAR: { logo: buildNhlLogoUrl('CAR') },
  CHI: { logo: buildNhlLogoUrl('CHI') },
  COL: { logo: buildNhlLogoUrl('COL') },
  CBJ: { logo: buildNhlLogoUrl('CBJ') },
  DAL: { logo: buildNhlLogoUrl('DAL') },
  DET: { logo: buildNhlLogoUrl('DET') },
  EDM: { logo: buildNhlLogoUrl('EDM') },
  FLA: { logo: buildNhlLogoUrl('FLA') },
  LAK: { logo: buildNhlLogoUrl('LAK') },
  MIN: { logo: buildNhlLogoUrl('MIN') },
  MTL: { logo: buildNhlLogoUrl('MTL') },
  NSH: { logo: buildNhlLogoUrl('NSH') },
  NJD: { logo: buildNhlLogoUrl('NJD') },
  NYI: { logo: buildNhlLogoUrl('NYI') },
  NYR: { logo: buildNhlLogoUrl('NYR') },
  OTT: { logo: buildNhlLogoUrl('OTT') },
  PHI: { logo: buildNhlLogoUrl('PHI') },
  PIT: { logo: buildNhlLogoUrl('PIT') },
  SJS: { logo: buildNhlLogoUrl('SJS') },
  SEA: { logo: buildNhlLogoUrl('SEA') },
  STL: { logo: buildNhlLogoUrl('STL') },
  TBL: { logo: buildNhlLogoUrl('TBL') },
  TOR: { logo: buildNhlLogoUrl('TOR') },
  UTA: { logo: buildNhlLogoUrl('UTA') },
  VAN: { logo: buildNhlLogoUrl('VAN') },
  VGK: { logo: buildNhlLogoUrl('VGK') },
  WSH: { logo: buildNhlLogoUrl('WSH') },
  WPG: { logo: buildNhlLogoUrl('WPG') },
}

export const getTeamMetadata = (abbreviation) =>
  TEAM_METADATA_BY_ABBREVIATION[abbreviation] ?? {}
