import type { AnswerPresentation } from "../../types/assistant";
import InvoiceStatement from "./InvoiceStatement";
import "./AnswerDetails.css";

export default function AnswerDetails({
  presentation,
}: {
  presentation?: AnswerPresentation | null;
}) {
  if (!presentation || (!presentation.cards.length && !presentation.invoices.length)) return null;
  return (
    <div className="answer-details" dir="rtl">
      <div className="details-heading">
        <h3>{presentation.title}</h3>
        <span>{presentation.source === "user" ? "מהחשבון שלך" : "מאתר NOVA TV"}</span>
      </div>
      {!!presentation.cards.length && (
        <div className="information-grid">
          {presentation.cards.map((card) => (
            <article className="information-card" key={card.id}>
              {card.badge && <span className="information-badge">{card.badge}</span>}
              <h4>{card.title}</h4>
              {card.description && <p dir="auto">{card.description}</p>}
              {card.progress != null && (
                <progress
                  max={100}
                  value={card.progress}
                  aria-label={`התקדמות צפייה: ${card.progress}%`}
                />
              )}
              <dl>
                {card.facts.map((fact, index) => (
                  <div key={`${fact.label}-${index}`}>
                    <dt>{fact.label}</dt>
                    <dd>
                      <bdi>{fact.value}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      )}
      {presentation.invoices.map((invoice) => (
        <InvoiceStatement key={invoice.id} invoice={invoice} />
      ))}
    </div>
  );
}
