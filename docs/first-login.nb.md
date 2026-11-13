# Førstegangsinnlogging og personlig BookStack API-nøkkel

MCP-en bruker jobbkontoen din til innlogging og din egen BookStack-nøkkel til dokumenttilgang. BookStack bestemmer hvilke dokumenter du kan lese og endre.

## Før du begynner

Du trenger en egen BookStack-bruker og rettigheten **Access System API** på minst én av rollene dine. Hvis du ikke ser API Tokens i brukerprofilen, må BookStack-administrator kontrollere rollen. Du trenger ikke en felles administratorkonto.

## Opprett nøkkel i BookStack

1. Åpne organisasjonens BookStack, og logg inn som deg selv. For den første planlagte installasjonen er adressen `https://doc.tronderdata.no`.
2. Åpne brukerprofilen din og velg å redigere profilen.
3. Finn **API Tokens**, og velg **Create Token**.
4. Gi tokenet et forståelig navn, for eksempel «ChatGPT BookStack», og sett en passende utløpsdato.
5. Lagre. Kopier **Token ID** og **Token Secret**. Hemmeligheten vises normalt bare én gang. Oppbevar den i godkjent passordhvelv.

Send aldri Token ID eller Token Secret i chat, verktøyargumenter, e-post eller skjermbilder til feilsøking.

## Koble nøkkelen til MCP-en

1. Åpne [BookStack-oppsettet](https://bookstack-mcp.tronderdata.no/setup). Dette er oppsettsadressen for Trønder Data-installasjonen; andre installasjoner har sin egen adresse med stien `/setup`.
2. Logg inn gjennom Keycloak med jobbkontoen din. Kontroller domenet før du legger inn opplysninger.
3. Lim Token ID og Token Secret inn i det sikre skjemaet.
4. Bekreft at dette er **din egen personlige** nøkkel, og velg **Test og lagre nøkkel**.
5. MCP-en gjør et lesekall til BookStack for å teste nøkkelen. Den lagrer den kryptert bare hvis testen og versjonskontrollen lykkes.
6. Oppsettsiden viser at du har en lagret nøkkel. Selve nøkkelen blir aldri vist igjen.

BookStacks dokumenterte API i den kontrollerte versjonen kan ikke bekrefte hvilken person som eier den innsendte nøkkelen. En vellykket test beviser at nøkkelen virker, ikke at eieren er samme person som jobbkontoen. Derfor må du selv sikre at du bruker din egen nøkkel.

## Koble til ChatGPT når pluginen er klargjort

Åpne BookStack-pluginen som drift har delt, og godkjenn egen Keycloak-innlogging. Bruk samme personlige jobbkonto som på oppsettsiden. ChatGPT skal ikke be deg skrive BookStack-nøkkelen i samtalen. Pluginens «Kom i gang»-veiledning viser oppsettslenken og leder deg gjennom nøkkelregistreringen hvis du mangler en lagret nøkkel.

Be først om tilkoblingsstatus, og prøv deretter et søk etter et dokument du kjenner. Tilgang til skriving krever et eget OAuth-scope i tillegg til BookStack-rettighetene dine. Hvis tjenesten sier at en personlig nøkkel mangler, bruk oppsettsiden med samme jobbkonto som i ChatGPT-innloggingen.

## Erstatt eller fjern nøkkelen

På `/setup` kan du erstatte nøkkelen. Den gamle lagrede kopien beholdes hvis den nye ikke kan testes. Opprett ny nøkkel i BookStack, lagre/test den her, kontroller tilgang, og slett deretter det gamle tokenet i BookStack.

Handlingene har ulike virkninger:

| Handling                                   | Virkning                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Koble fra pluginen i ChatGPT               | Avslutter den ChatGPT-tilkoblingen; sletter ikke automatisk lagret BookStack-nøkkel |
| Fjern min lagrede nøkkel på oppsettsiden   | Sletter kopien MCP-en bruker; tilbakekaller ikke tokenet i BookStack                |
| Slett tokenet under API Tokens i BookStack | Tilbakekaller selve API-tilgangen for alle som har dette tokenet                    |
| Logg ut av oppsettsiden                    | Avslutter bare nettøkten på denne nettsiden                                         |

Hvis nøkkelen kan ha kommet på avveie, slett tokenet i BookStack. Å koble fra ChatGPT eller fjerne en lagret kopi alene gjør ikke andre kopier ugyldige.

## Når noe feiler

- **Innlogging mangler/er utløpt:** Logg inn eller koble til igjen.
- **Personlig nøkkel mangler:** Lagre nøkkelen på oppsettsiden.
- **Nøkkelen avvises/er utløpt:** Opprett en ny personlig nøkkel og erstatt den lagrede.
- **BookStack avviser tilgang:** Kontroller Access System API, utløpsdato og dokumentrettigheter med administrator.
- **Nettverksfeil eller serverfeil ved skriving:** Kontroller om endringen faktisk kom inn i BookStack før du prøver igjen.

Oppgi **korrelasjons-ID** fra feilen til drift. Ikke send Token ID, Token Secret, tilgangstokens eller dokumentinnhold som ikke trengs for feilsøkingen.
