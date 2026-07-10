import { Catalog } from '@a2ui/web_core/v0_9';
import { basicCatalog } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { Table } from './table';

export const dynamicUiCatalog = new Catalog<ReactComponentImplementation>(
  'dynamic-ui-catalog',
  [...basicCatalog.components.values(), Table],
);
