import { OptionManager } from '@/components/option-manager';
import { addCategory, listCategories, removeCategory } from '@/db/categories';
import { DEFAULT_CATEGORY, MAX_OPTION_LENGTH } from '@/lib/categories';

export default function CategoriesScreen() {
  return (
    <OptionManager
      placeholder={`最多 ${MAX_OPTION_LENGTH} 个字，如：宠物`}
      load={listCategories}
      add={addCategory}
      remove={removeCategory}
      protectedName={DEFAULT_CATEGORY}
      protectedTitle="「其他」不可删除"
      protectedMessage="识别失败时会默认归入这个分类。"
    />
  );
}
