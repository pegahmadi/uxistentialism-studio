import { redirect } from "next/navigation";

// Today is "the present — where attention is now"; the natural entry point.
export default function Home() {
  redirect("/today");
}
