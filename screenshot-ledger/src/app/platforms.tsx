import { OptionManager } from '@/components/option-manager';
import { addPlatform, listPlatforms, removePlatform } from '@/db/platforms';
import { MAX_OPTION_LENGTH } from '@/lib/categories';

export default function PlatformsScreen() {
  return (
    <OptionManager
      placeholder={`最多 ${MAX_OPTION_LENGTH} 个字，如：山姆`}
      load={listPlatforms}
      add={addPlatform}
      remove={removePlatform}
    />
  );
}
