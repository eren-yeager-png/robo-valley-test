export default function Loading() {
  return (
    <div className="adm-skel" role="status" aria-label="Loading">
      <div className="bar w40" />
      <div className="grid"><div className="box" /><div className="box" /><div className="box" /></div>
      <div className="bar" />
      <div className="bar w70" />
    </div>
  );
}
