"use client";

import { pinyin } from "pinyin-pro";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

export type Category = {
  id: string;
  name: string;
  display_name: string;
  sort_order: number;
  category_subcategories?: Subcategory[];
};

export type Subcategory = {
  id: string;
  name: string;
  display_name: string;
  examples: { examples: string[] };
  sort_order: number;
};

export type CategoryUsageRow = {
  category: string;
};

export type CategorySuggestion = {
  key: string;
  categoryId: string;
  categoryDisplayName: string;
  subcategoryDisplayName: string;
  examples: string[];
  categorySort: number;
  subcategorySort: number;
  usageCount: number;
  categoryInitials: string;
  subcategoryInitials: string;
  isRandomOption?: boolean;
};

const ALL_CATEGORY_RANDOM = "全部分类（系统随机）";

const normalizeSearchText = (value: string) => value.toLowerCase().replace(/\s+/g, "");

const subsequenceMatch = (target: string, query: string) => {
  if (!query) return true;
  let qi = 0;
  for (let i = 0; i < target.length && qi < query.length; i += 1) {
    if (target[i] === query[qi]) qi += 1;
  }
  return qi === query.length;
};

const toPinyinInitials = (value: string) => {
  try {
    return pinyin(value, {
      pattern: "first",
      toneType: "none",
      type: "array",
      nonZh: "consecutive",
    })
      .join("")
      .toLowerCase()
      .replace(/\s+/g, "");
  } catch {
    return "";
  }
};

export const useCategorySearch = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryUsageMap, setCategoryUsageMap] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState("");

  const refreshCategoryUsage = useCallback(async () => {
    const [roomsRes, historyRes] = await Promise.all([
      supabase.from("rooms").select("category"),
      supabase.from("room_word_history").select("category"),
    ]);

    if (roomsRes.error) {
      console.error("Failed to load rooms category usage:", roomsRes.error);
    }
    if (historyRes.error) {
      console.error("Failed to load room_word_history category usage:", historyRes.error);
    }

    const usage: Record<string, number> = {};
    const rows = [
      ...((roomsRes.data ?? []) as CategoryUsageRow[]),
      ...((historyRes.data ?? []) as CategoryUsageRow[]),
    ];

    rows.forEach((row) => {
      const key = row.category?.trim();
      if (!key) return;
      usage[key] = (usage[key] ?? 0) + 1;
    });

    setCategoryUsageMap(usage);
  }, []);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch("/api/categories");
        if (!res.ok) throw new Error("Failed to fetch categories");
        const data = await res.json();
        setCategories(data.categories || []);
      } catch (err) {
        console.error("Failed to fetch categories:", err);
      }
    };
    fetchCategories();
  }, []);

  useEffect(() => {
    void refreshCategoryUsage();
  }, [refreshCategoryUsage]);

  const allCategorySuggestions = useMemo(() => {
    return categories.flatMap((category) =>
      (category.category_subcategories ?? []).map((subcategory) => ({
        key: `${category.id}-${subcategory.id}`,
        categoryId: category.id,
        categoryDisplayName: category.display_name,
        subcategoryDisplayName: subcategory.display_name,
        examples: subcategory.examples?.examples ?? [],
        categorySort: category.sort_order,
        subcategorySort: subcategory.sort_order,
        usageCount: categoryUsageMap[subcategory.display_name] ?? 0,
        categoryInitials: toPinyinInitials(category.display_name),
        subcategoryInitials: toPinyinInitials(subcategory.display_name),
      }))
    );
  }, [categories, categoryUsageMap]);

  const buildCategorySuggestions = useCallback(
    (rawQuery: string, emptyLimit = 10) => {
      const query = rawQuery.trim().toLowerCase();
      const q = normalizeSearchText(query);
      const randomInitials = toPinyinInitials(ALL_CATEGORY_RANDOM);
      const randomOption: CategorySuggestion = {
        key: "all-random",
        categoryId: "",
        categoryDisplayName: "随机模式",
        subcategoryDisplayName: ALL_CATEGORY_RANDOM,
        examples: ["每局随机", "无需手动选择"],
        categorySort: -1,
        subcategorySort: -1,
        usageCount: 0,
        categoryInitials: "sj",
        subcategoryInitials: randomInitials,
        isRandomOption: true,
      };

      const randomMatches =
        !q ||
        randomOption.subcategoryDisplayName.includes(query) ||
        randomOption.subcategoryInitials.includes(q) ||
        "allrandomsuijiquanbu".includes(q);

      if (!query) {
        const top = [...allCategorySuggestions]
          .sort((a, b) => {
            if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
            if (a.categorySort !== b.categorySort) return a.categorySort - b.categorySort;
            return a.subcategorySort - b.subcategorySort;
          })
          .slice(0, Math.max(emptyLimit - 1, 0));

        return [randomOption, ...top];
      }

      const matches = allCategorySuggestions
        .map((item) => {
          const categoryName = normalizeSearchText(item.categoryDisplayName);
          const subcategoryName = normalizeSearchText(item.subcategoryDisplayName);
          const exampleText = normalizeSearchText(item.examples.join(" "));
          const categoryInitials = item.categoryInitials;
          const subcategoryInitials = item.subcategoryInitials;

          let score = 0;
          if (subcategoryName.startsWith(q)) score += 6;
          if (subcategoryName.includes(q)) score += 5;
          if (categoryName.includes(q)) score += 4;
          if (subcategoryInitials.startsWith(q)) score += 4;
          if (subcategoryInitials.includes(q)) score += 3;
          if (categoryInitials.startsWith(q)) score += 3;
          if (categoryInitials.includes(q)) score += 2;
          if (exampleText.includes(q)) score += 2;
          if (subsequenceMatch(subcategoryName, q)) score += 1;
          if (subsequenceMatch(subcategoryInitials, q)) score += 1;

          return { item, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (b.item.usageCount !== a.item.usageCount) return b.item.usageCount - a.item.usageCount;
          if (a.item.categorySort !== b.item.categorySort) return a.item.categorySort - b.item.categorySort;
          return a.item.subcategorySort - b.item.subcategorySort;
        })
        .map(({ item }) => item)
        .slice(0, 20);

      if (!randomMatches) return matches;
      return [randomOption, ...matches];
    },
    [allCategorySuggestions]
  );

  const suggestions = useMemo(() => buildCategorySuggestions(searchQuery), [buildCategorySuggestions, searchQuery]);

  return {
    categories,
    categoryUsageMap,
    refreshCategoryUsage,
    searchQuery,
    setSearchQuery,
    suggestions,
    buildCategorySuggestions,
    allCategorySuggestions,
  };
};
