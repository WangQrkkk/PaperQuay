import {
  getAppDefaultPaths,
  readLocalTextFile,
  writeLocalTextFile,
  type AppDefaultPaths,
} from './desktop';
import type { ReaderConfigFile } from '../types/reader';

export async function readReaderConfigFile(
  defaultPaths?: AppDefaultPaths | null,
): Promise<Partial<ReaderConfigFile> | null> {
  const paths = defaultPaths ?? await getAppDefaultPaths();
  const configText = await readLocalTextFile(paths.configPath);

  return JSON.parse(configText) as Partial<ReaderConfigFile>;
}

export async function writeReaderConfigFile(
  config: Partial<ReaderConfigFile>,
  defaultPaths?: AppDefaultPaths | null,
): Promise<void> {
  const paths = defaultPaths ?? await getAppDefaultPaths();
  await writeLocalTextFile(paths.configPath, JSON.stringify(config, null, 2));
}
