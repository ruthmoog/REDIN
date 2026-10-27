FROM pierrezemb/gostatic
COPY . /srv/http/
CMD ["-port","8080", "-enable-logging"]
