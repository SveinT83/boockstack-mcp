---
name: bookstack-setup
description: Hjelp nye ansatte i gang med BookStack-pluginen, personlig innlogging og registrering eller utskifting av egen API-nøkkel.
---

# Kom i gang med BookStack

Start med en tydelig, klikkbar lenke: [Åpne BookStack-oppsettet](https://bookstack-mcp.tronderdata.no/setup). Forklar kort at ChatGPT-innloggingen identifiserer brukeren, mens en personlig BookStack-nøkkel gir dokumenttilgang. Nøkkelen registreres på oppsettsiden og lagres kryptert hos MCP-tjenesten.

Hvis denne pluginens eget `bookstack_connection_status` er tilgjengelig, kall det før du ber brukeren opprette en nøkkel. `connected: true` betyr at en nøkkel er lagret; det er ikke en ny kontroll mot BookStack. Ikke be en bruker med lagret nøkkel om å opprette den på nytt. Ved `connected: false`, eller hvis brukeren vil erstatte en avvist eller utløpt nøkkel, vis disse trinnene:

1. Åpne [BookStack-oppsettet](https://bookstack-mcp.tronderdata.no/setup), og logg inn med samme personlige jobbkonto som i ChatGPT-tilkoblingen.
2. Åpne [BookStack](https://doc.tronderdata.no) i en annen fane. Rediger din egen brukerprofil, finn **API Tokens**, og velg **Create Token**. Bruk gjerne navnet «ChatGPT BookStack» og en passende utløpsdato. Hvis API Tokens mangler, be BookStack-administrator kontrollere rettigheten **Access System API**.
3. Kopier **Token ID** og **Token Secret** direkte inn i skjemaet på oppsettsiden. Bekreft at nøkkelen er din egen, og velg **Test og lagre nøkkel**. Vent på bekreftelsen om at nøkkelen er lagret.
4. Gå tilbake til denne chatten og skriv «Ferdig». Kall deretter `bookstack_connection_status` på nytt. Bruk et lesekall eller et søk etter et dokument brukeren oppgir for å kontrollere faktisk dokumenttilgang; status alene bekrefter bare lagring.

Be aldri om Token ID, Token Secret, passord, OAuth-token eller skjermbilder med hemmeligheter i chatten. Brukeren fyller selv inn nøkkelen i nettleseren. Bruk aldri en felles nøkkel eller en annen persons konto.

Hvis denne direkte pluginens verktøy mangler, vis likevel oppsettslenken, men si at ChatGPT-tilkoblingen må aktiveres før den kan kontrolleres. Ikke bruk gateway, LiteLLM eller andre BookStack-integrasjoner som erstatning eller bevis på at denne pluginen fungerer.

Skill mellom manglende lagret nøkkel, utløpt OAuth-innlogging, avvist BookStack-nøkkel og manglende dokumentrettigheter. Oppgi korrelasjons-ID ved feil. Ikke lov at tilkoblingen er ferdig før resultatet fra de relevante kontrollene foreligger.
