FROM heroiclabs/nakama:3.22.0

WORKDIR /nakama/data

COPY ./backend /nakama/data/modules
COPY ./config.yml /nakama/data/config.yml

# Write the startup script into the image
RUN printf '#!/bin/sh\n/nakama/nakama migrate up --database.address "$DATABASE_URL"\nexec /nakama/nakama --config /nakama/data/config.yml --database.address "$DATABASE_URL"\n' > /nakama/start.sh && chmod +x /nakama/start.sh

EXPOSE 7350
EXPOSE 7351

ENTRYPOINT ["/nakama/start.sh"]