/** Keep route content visible while client code loads; animate individual controls instead. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full flex-col">{children}</div>;
}
