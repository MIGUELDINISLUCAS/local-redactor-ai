import { useState } from 'react';

interface Framework {
  id: string;
  name: string;
  subtitle: string;
  clauses: { ref: string; text: string }[];
}

const frameworks: Framework[] = [
  {
    id: 'gdpr',
    name: 'GDPR',
    subtitle: 'Data minimisation & protection by design',
    clauses: [
      { ref: 'Article 5(1)(c)', text: 'Data minimisation — only process what is necessary. Redaction strips PII before it reaches the AI provider.' },
      { ref: 'Article 25', text: 'Data protection by design and by default — local redaction embeds privacy into the architecture.' },
      { ref: 'Article 32', text: 'Security of processing — pseudonymisation is listed as an appropriate technical measure.' },
      { ref: 'Articles 44–49', text: 'Transfer restrictions — redaction avoids cross-border transfer issues since PII never leaves the device.' },
    ],
  },
  {
    id: 'iso27001',
    name: 'ISO 27001',
    subtitle: 'Data masking & leakage prevention',
    clauses: [
      { ref: 'A.8.11 Data masking', text: 'Obfuscate PII before sharing with third parties. This is exactly what Local Redactor does.' },
      { ref: 'A.8.12 Data leakage prevention', text: 'Prevent unauthorised disclosure of sensitive information — local redaction is a DLP mechanism.' },
      { ref: 'A.8.10 Information deletion', text: 'Ensure PII is removed when no longer needed. Redaction prevents it from ever leaving the device.' },
    ],
  },
  {
    id: 'iso27701',
    name: 'ISO 27701',
    subtitle: 'Privacy information management',
    clauses: [
      { ref: '7.4.1 Limit collection', text: 'Minimise PII collected and processed. Redaction ensures AI services never receive it.' },
      { ref: '7.4.5 De-identification', text: 'De-identify PII when full data is not required for processing.' },
      { ref: '8.5.2 Transfer & disposal', text: 'Control return, transfer, and disposal of PII — redaction prevents transfer entirely.' },
    ],
  },
  {
    id: 'soc2',
    name: 'SOC 2',
    subtitle: 'Confidentiality & privacy criteria',
    clauses: [
      { ref: 'CC6.7', text: 'Restrict transmission of data to authorised parties — redaction prevents PII transmission to AI providers.' },
      { ref: 'P3.1 Collection limitation', text: 'Collect only the PII necessary for the identified purpose.' },
      { ref: 'P6.1 Disclosure limitation', text: 'Limit disclosure of PII to identified purposes and third parties.' },
    ],
  },
  {
    id: 'hipaa',
    name: 'HIPAA',
    subtitle: 'Protected health information safeguards',
    clauses: [
      { ref: '§164.312(e)(1)', text: 'Transmission security — protect ePHI during electronic transmission to external services.' },
      { ref: '§164.502(d) & §164.514', text: 'De-identification standard — removing identifiers so data is no longer PHI (safe harbor method).' },
    ],
  },
  {
    id: 'dora',
    name: 'DORA',
    subtitle: 'EU financial sector ICT risk',
    clauses: [
      { ref: 'Article 9', text: 'Protection and prevention — implement ICT security tools to minimise data risks with third-party services.' },
      { ref: 'Article 28', text: 'Third-party ICT risk — manage and reduce data exposure when using external AI providers.' },
    ],
  },
];

function Accordion({ fw }: { fw: Framework }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`compliance-item ${open ? 'open' : ''}`}>
      <button className="compliance-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="compliance-name">{fw.name}</span>
        <span className="compliance-sub">{fw.subtitle}</span>
        <span className="compliance-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="compliance-detail">
          {fw.clauses.map((c) => (
            <div className="compliance-clause" key={c.ref}>
              <span className="clause-ref">{c.ref}</span>
              <span className="clause-text">{c.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ComplianceSection() {
  return (
    <section className="section-block compliance-section" id="compliance">
      <div className="compliance-intro">
        <div className="eyebrow dark"><span className="eyebrow-dot" /> Compliance</div>
        <h2>Supports the frameworks<br /><em>you already follow.</em></h2>
        <p>Local Redactor implements data masking, minimisation, and leakage prevention at the architectural level. Click any framework to see the relevant clauses.</p>
      </div>
      <div className="compliance-list">
        {frameworks.map((fw) => <Accordion fw={fw} key={fw.id} />)}
      </div>
    </section>
  );
}
