import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function GET() {
  try {
    // 获取所有主类别
    const { data: categories, error: categoriesError } = await supabase
      .from('categories')
      .select(
        `
        id,
        name,
        display_name,
        sort_order,
        category_subcategories(
          id,
          name,
          display_name,
          examples,
          sort_order
        )
      `
      )
      .order('sort_order', { ascending: true })
      .order('sort_order', {
        ascending: true,
        foreignTable: 'category_subcategories',
      });

    if (categoriesError) {
      console.error('Categories fetch error:', categoriesError);
      return Response.json(
        { error: 'Failed to fetch categories' },
        { status: 500 }
      );
    }

    return Response.json({ categories });
  } catch (err) {
    console.error('Unexpected error:', err);
    return Response.json(
      { error: 'Unexpected error' },
      { status: 500 }
    );
  }
}
